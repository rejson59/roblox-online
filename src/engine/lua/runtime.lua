--!nolint
--[[
  runtime.lua — implementacja środowiska Robloxa po stronie Luau.

  Prawdziwy Roblox ma API w C++. Tutaj robimy to samo, tylko w Luau: DataTypy
  (Vector3/CFrame/Color3/...), system sygnałów (eventów), scheduler zadań
  oparty na korutynach oraz klasę `Instance`. Mostek do JS (`host`) dostarcza
  tylko niskopoziomowe operacje na drzewie instancji, czas i kolejkę zdarzeń.
]]

local host = host -- wstrzyknięte przez JS

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Logowanie
-- ─────────────────────────────────────────────────────────────────────────────
local function fmtArgs(...)
	local parts = {}
	for i = 1, select('#', ...) do
		local v = select(i, ...)
		local ok, s = pcall(tostring, v)
		parts[#parts + 1] = ok and s or '?'
	end
	return table.concat(parts, ' ')
end

local warned = {}
function print(...) host.log('info', fmtArgs(...)) end
function warn(...)
	local msg = fmtArgs(...)
	if not warned[msg] then warned[msg] = true; host.log('warn', msg) end
end
function error_(...) end
local realError = error
function error(message, level)
	host.log('error', tostring(message))
	realError(message, (level or 1) + 1)
end

local RNOW = 0 -- czas gry ustawiany przez JS na początku ticku
local function now() return RNOW end


-- ─────────────────────────────────────────────────────────────────────────────
-- 0b. Mini-dekoder JSON
--    Mostek JS -> Lua nie umie przekazać tablic (JS array staje się liczbą),
--    więc złożone dane przesyłamy jako tekst JSON i dekodujemy tutaj.
-- ─────────────────────────────────────────────────────────────────────────────
local JSON = {}
do
	local strsub, strfind, strchar = string.sub, string.find, string.char
	local concat = table.concat
	local function decode(text)
		if type(text) ~= 'string' or text == '' then return nil end
		local pos = 1
		local len = #text
		local function skip()
			while pos <= len do
				local c = strsub(text, pos, pos)
				if c == ' ' or c == '\n' or c == '\t' or c == '\r' then pos += 1 else break end
			end
		end
		local parseValue
		local function parseString()
			pos += 1
			local out, n = {}, 0
			while true do
				local c = strsub(text, pos, pos)
				if c == '' then error('JSON: nieoczekiwany koniec tekstu') end
				if c == '"' then pos += 1 break end
				if c == '\\' then
					pos += 1
					local e = strsub(text, pos, pos)
					if e == 'n' then n += 1; out[n] = '\n'
					elseif e == 't' then n += 1; out[n] = '\t'
					elseif e == 'r' then n += 1; out[n] = '\r'
					elseif e == 'b' then n += 1; out[n] = '\b'
					elseif e == 'f' then n += 1; out[n] = '\f'
					elseif e == 'u' then
						local hex = strsub(text, pos + 1, pos + 4)
						pos += 4
						local code = tonumber(hex, 16) or 63
						n += 1; out[n] = utf8.char(code)
					else n += 1; out[n] = e end
					pos += 1
				else
					n += 1; out[n] = c
					pos += 1
				end
			end
			return concat(out)
		end
		local function parseNumber()
			local s, e = strfind(text, '^-?%d+%.?%d*[eE]?[-+]?%d*', pos)
			if not s then error('JSON: zła liczba') end
			local raw = strsub(text, s, e)
			pos = e + 1
			return tonumber(raw)
		end
		parseValue = function()
			skip()
			local c = strsub(text, pos, pos)
			if c == '{' then
				pos += 1
				local obj = {}
				skip()
				if strsub(text, pos, pos) == '}' then pos += 1 return obj end
				while true do
					skip()
					local key = parseString()
					skip()
					if strsub(text, pos, pos) ~= ':' then error('JSON: oczekiwano :') end
					pos += 1
					obj[key] = parseValue()
					skip()
					local d = strsub(text, pos, pos)
					pos += 1
					if d == '}' then break elseif d ~= ',' then error('JSON: oczekiwano , lub }') end
				end
				return obj
			elseif c == '[' then
				pos += 1
				local arr = {}
				skip()
				if strsub(text, pos, pos) == ']' then pos += 1 return arr end
				while true do
					arr[#arr + 1] = parseValue()
					skip()
					local d = strsub(text, pos, pos)
					pos += 1
					if d == ']' then break elseif d ~= ',' then error('JSON: oczekiwano , lub ]') end
				end
				return arr
			elseif c == '"' then
				return parseString()
			elseif strsub(text, pos, pos + 3) == 'true' then pos += 4 return true
			elseif strsub(text, pos, pos + 4) == 'false' then pos += 5 return false
			elseif strsub(text, pos, pos + 3) == 'null' then pos += 4 return nil
			else
				return parseNumber()
			end
		end
		local ok, result = pcall(parseValue)
		if not ok then
			host.log('error', 'JSON: ' .. tostring(result))
			return nil
		end
		return result
	end
	JSON.decode = decode
	-- enkoder (dla danych wysyłanych do JS w postaci tekstu)
	local function encode(v, seen)
		local t = type(v)
		if v == nil then return 'null' end
		if t == 'number' then return tostring(v) end
		if t == 'boolean' then return v and 'true' or 'false' end
		if t == 'string' then
			return '"' .. v:gsub('[%z\1-\31\\"]', function(ch)
				if ch == '"' then return '\\"' elseif ch == '\\' then return '\\\\'
				elseif ch == '\n' then return '\\n' elseif ch == '\t' then return '\\t' elseif ch == '\r' then return '\\r'
				else return string.format('\\u%04x', ch:byte()) end
			end) .. '"'
		end
		if t == 'table' then
			seen = seen or {}
			if seen[v] then return 'null' end
			seen[v] = true
			if #v > 0 then
				local parts = {}
				for i = 1, #v do parts[i] = encode(v[i], seen) end
				seen[v] = nil
				return '[' .. concat(parts, ',') .. ']'
			end
			local parts = {}
			for k, val in pairs(v) do
				if type(k) == 'string' or type(k) == 'number' then
					parts[#parts + 1] = encode(tostring(k), seen) .. ':' .. encode(val, seen)
				end
			end
			seen[v] = nil
			return '{' .. concat(parts, ',') .. '}'
		end
		if v and type(v) == 'table' and v.__id then return tostring(v.__id) end
		return 'null'
	end
	JSON.encode = function(v) return encode(v) end
end
RBX_JSON = JSON

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DataTypy
-- ─────────────────────────────────────────────────────────────────────────────
local V3 = {}
V3.__index = V3
local v3mt = {
	__index = V3,
	__add = function(a, b) return V3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end,
	__sub = function(a, b) return V3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end,
	__mul = function(a, b)
		if type(b) == 'number' then return V3.new(a.X * b, a.Y * b, a.Z * b) end
		if type(a) == 'number' then return V3.new(b.X * a, b.Y * a, b.Z * a) end
		return V3.new(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
	end,
	__div = function(a, b)
		if type(b) == 'number' then return V3.new(a.X / b, a.Y / b, a.Z / b) end
		return V3.new(a.X / b.X, a.Y / b.Y, a.Z / b.Z)
	end,
	__unm = function(a) return V3.new(-a.X, -a.Y, -a.Z) end,
	__eq = function(a, b) return a.X == b.X and a.Y == b.Y and a.Z == b.Z end,
	__tostring = function(a) return string.format('%g, %g, %g', a.X, a.Y, a.Z) end,
}
function V3.new(x, y, z)
	local v = setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, v3mt)
	v.x, v.y, v.z = v.X, v.Y, v.Z
	return v
end
function V3.__index(self, key)
	local k = key
	if k == 'Magnitude' then return math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z) end
	if k == 'Unit' then
		local m = math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z)
		if m == 0 then return V3.new(0, 0, 0) end
		return V3.new(self.X / m, self.Y / m, self.Z / m)
	end
	if k == 'x' or k == 'y' or k == 'z' then return rawget(self, k) end
	return V3[key]
end
function V3:Dot(o) return self.X * o.X + self.Y * o.Y + self.Z * o.Z end
function V3:Cross(o)
	return V3.new(self.Y * o.Z - self.Z * o.Y, self.Z * o.X - self.X * o.Z, self.X * o.Y - self.Y * o.X)
end
function V3:Lerp(o, t) return self + (o - self) * t end
function V3:Abs() return V3.new(math.abs(self.X), math.abs(self.Y), math.abs(self.Z)) end
function V3:Ceil() return V3.new(math.ceil(self.X), math.ceil(self.Y), math.ceil(self.Z)) end
function V3:Floor() return V3.new(math.floor(self.X), math.floor(self.Y), math.floor(self.Z)) end
function V3:FuzzyEq(o, e) return (self - o).Magnitude <= (e or 1e-5) end
V3.zero = V3.new(0, 0, 0)
V3.one = V3.new(1, 1, 1)
V3.xAxis = V3.new(1, 0, 0)
V3.yAxis = V3.new(0, 1, 0)
V3.zAxis = V3.new(0, 0, 1)
local Vector3 = setmetatable({ new = V3.new, zero = V3.zero, one = V3.one,
	xAxis = V3.xAxis, yAxis = V3.yAxis, zAxis = V3.zAxis }, { __index = V3 })
Vector3.FromNormalId = function(n)
	local names = { [0] = 'Right', 'Top', 'Back', 'Left', 'Bottom', 'Front' }
	local v = { V3.new(1, 0, 0), V3.new(0, 1, 0), V3.new(0, 0, 1), V3.new(-1, 0, 0), V3.new(0, -1, 0), V3.new(0, 0, -1) }
	return v[(n.Value or n) + 1]
end
Vector3.FromAxis = function(a) return ({ V3.new(1, 0, 0), V3.new(0, 1, 0), V3.new(0, 0, 1) })[(a.Value or a) + 1] end

-- Vector2 (uproszczony)
local V2 = {}
V2.__index = V2
local v2mt = {
	__index = V2,
	__add = function(a, b) return V2.new(a.X + b.X, a.Y + b.Y) end,
	__sub = function(a, b) return V2.new(a.X - b.X, a.Y - b.Y) end,
	__mul = function(a, b) return V2.new(a.X * b, a.Y * b) end,
	__tostring = function(a) return string.format('%g, %g', a.X, a.Y) end,
}
function V2.new(x, y) return setmetatable({ X = x or 0, Y = y or 0 }, v2mt) end
V2.__index = function(self, k)
	if k == 'Magnitude' then return math.sqrt(self.X ^ 2 + self.Y ^ 2) end
	if k == 'Unit' then
		local m = math.sqrt(self.X ^ 2 + self.Y ^ 2); if m == 0 then return V2.new(0, 0) end
		return V2.new(self.X / m, self.Y / m)
	end
	return V2[k]
end
function V2:Dot(o) return self.X * o.X + self.Y * o.Y end
function V2:Lerp(o, t) return V2.new(self.X + (o.X - self.X) * t, self.Y + (o.Y - self.Y) * t) end
local Vector2 = { new = V2.new, zero = V2.new(0, 0), one = V2.new(1, 1) }

-- CFrame: pozycja + macierz obrotu 3x3 (wiersze r00..r22, jak w Robloxie)
local CF = {}
local cfmt = {}
cfmt.__index = function(self, key)
	local k = key
	if k == 'X' then return self[1] elseif k == 'Y' then return self[2] elseif k == 'Z' then return self[3] end
	if k == 'p' or k == 'Position' then return V3.new(self[1], self[2], self[3]) end
	if k == 'RightVector' then return V3.new(self[4], self[7], self[10]) end
	if k == 'UpVector' then return V3.new(self[5], self[8], self[11]) end
	if k == 'LookVector' then return V3.new(-self[6], -self[9], -self[12]) end
	if k == 'Rotation' then return CF.new(0, 0, 0, self[4], self[5], self[6], self[7], self[8], self[9], self[10], self[11], self[12]) end
	return CF[k]
end
cfmt.__mul = function(a, b)
	if getmetatable(b) == v3mt then
		return V3.new(
			a[4] * b.X + a[5] * b.Y + a[6] * b.Z + a[1],
			a[7] * b.X + a[8] * b.Y + a[9] * b.Z + a[2],
			a[10] * b.X + a[11] * b.Y + a[12] * b.Z + a[3])
	end
	-- a * b : złożenie transformacji
	local o = { a[4] * b[4] + a[5] * b[7] + a[6] * b[10], a[4] * b[5] + a[5] * b[8] + a[6] * b[11], a[4] * b[6] + a[5] * b[9] + a[6] * b[12],
		a[7] * b[4] + a[8] * b[7] + a[9] * b[10], a[7] * b[5] + a[8] * b[8] + a[9] * b[11], a[7] * b[6] + a[8] * b[9] + a[9] * b[12],
		a[10] * b[4] + a[11] * b[7] + a[12] * b[10], a[10] * b[5] + a[11] * b[8] + a[12] * b[11], a[10] * b[6] + a[11] * b[9] + a[12] * b[12] }
	local px = a[4] * b[1] + a[5] * b[2] + a[6] * b[3] + a[1]
	local py = a[7] * b[1] + a[8] * b[2] + a[9] * b[3] + a[2]
	local pz = a[10] * b[1] + a[11] * b[2] + a[12] * b[3] + a[3]
	return setmetatable({ px, py, pz, table.unpack(o) }, cfmt)
end
cfmt.__add = function(a, b) return setmetatable({ a[1] + b.X, a[2] + b.Y, a[3] + b.Z, a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12] }, cfmt) end
cfmt.__sub = function(a, b) return setmetatable({ a[1] - b.X, a[2] - b.Y, a[3] - b.Z, a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12] }, cfmt) end
cfmt.__tostring = function(a)
	local t = {}
	for i = 1, 12 do t[i] = string.format('%g', a[i]) end
	return table.concat(t, ', ')
end
cfmt.__eq = function(a, b)
	for i = 1, 12 do if math.abs(a[i] - b[i]) > 1e-6 then return false end end
	return true
end
function CF.new(...)
	local n = select('#', ...)
	if n == 0 then return setmetatable({ 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1 }, cfmt) end
	local first = ...
	if getmetatable(first) == v3mt then
		local look = select(2, ...)
		if look and getmetatable(look) == v3mt then return CF.lookAt(first, look) end
		return setmetatable({ first.X, first.Y, first.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1 }, cfmt)
	end
	if n >= 12 then
		local t = { ... }
		local out = {}
		for i = 1, 12 do out[i] = t[i] or 0 end
		return setmetatable(out, cfmt)
	end
	local x, y, z = ...
	return setmetatable({ x or 0, y or 0, z or 0, 1, 0, 0, 0, 1, 0, 0, 0, 1 }, cfmt)
end

local function rotFromEuler(rx, ry, rz)
	local cx, sx = math.cos(rx), math.sin(rx)
	local cy, sy = math.cos(ry), math.sin(ry)
	local cz, sz = math.cos(rz), math.sin(rz)
	-- R = Rx * Ry * Rz (kolejność Roblox XYZ)
	local r00 = cy * cz
	local r01 = -cy * sz
	local r02 = sy
	local r10 = sx * sy * cz + cx * sz
	local r11 = -sx * sy * sz + cx * cz
	local r12 = -sx * cy
	local r20 = -cx * sy * cz + sx * sz
	local r21 = cx * sy * sz + sx * cz
	local r22 = cx * cy
	return r00, r01, r02, r10, r11, r12, r20, r21, r22
end
CF.Angles = function(rx, ry, rz)
	local a, b, c, d, e, f, g, h, i = rotFromEuler(rx, ry, rz)
	return setmetatable({ 0, 0, 0, a, b, c, d, e, f, g, h, i }, cfmt)
end
CF.fromEulerAnglesXYZ = CF.Angles
CF.fromEulerAnglesYXZ = function(rx, ry, rz) return CF.Angles(ry, rx, rz) end
CF.fromAxisAngle = function(axis, angle)
	local ux, uy, uz = axis.X, axis.Y, axis.Z
	local m = math.sqrt(ux * ux + uy * uy + uz * uz); if m == 0 then return CF.new() end
	ux, uy, uz = ux / m, uy / m, uz / m
	local c, s = math.cos(angle), math.sin(angle)
	local t = 1 - c
	return setmetatable({ 0, 0, 0,
		t * ux * ux + c, t * ux * uy - s * uz, t * ux * uz + s * uy,
		t * ux * uy + s * uz, t * uy * uy + c, t * uy * uz - s * ux,
		t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c }, cfmt)
end
CF.lookAt = function(pos, target, up)
	up = up or V3.new(0, 1, 0)
	local dir = (target - pos)
	if dir.Magnitude < 1e-8 then dir = V3.new(0, 0, -1) end
	local zAxis = -dir.Unit
	local xAxis = up:Cross(zAxis)
	if xAxis.Magnitude < 1e-6 then xAxis = V3.new(1, 0, 0):Cross(zAxis) end
	xAxis = xAxis.Unit
	local yAxis = zAxis:Cross(xAxis)
	return setmetatable({ pos.X, pos.Y, pos.Z,
		xAxis.X, yAxis.X, zAxis.X,
		xAxis.Y, yAxis.Y, zAxis.Y,
		xAxis.Z, yAxis.Z, zAxis.Z }, cfmt)
end
CF.fromMatrix = function(pos, rx, ry, rz) return setmetatable({ pos.X, pos.Y, pos.Z, rx.X, ry.X, rz.X, rx.Y, ry.Y, rz.Y, rx.Z, ry.Z, rz.Z }, cfmt) end
function CF:Inverse()
	local x, y, z = self[1], self[2], self[3]
	local r00, r01, r02 = self[4], self[7], self[10]
	local r10, r11, r12 = self[5], self[8], self[11]
	local r20, r21, r22 = self[6], self[9], self[12]
	return setmetatable({
		-(r00 * x + r10 * y + r20 * z), -(r01 * x + r11 * y + r21 * z), -(r02 * x + r12 * y + r22 * z),
		r00, r10, r20, r01, r11, r21, r02, r12, r22 }, cfmt)
end
function CF:ToWorldSpace(other) return self * other end
function CF:ToObjectSpace(other) return self:Inverse() * other end
function CF:PointToWorldSpace(v) return self * v end
function CF:PointToObjectSpace(v) return self:Inverse() * v end
function CF:VectorToWorldSpace(v) return (self * CF.new(v)) * V3.new(0, 0, 0) - V3.new(self[1], self[2], self[3]) end
function CF:VectorToObjectSpace(v) return self:Inverse():VectorToWorldSpace(v) end
function CF:Lerp(other, t)
	local out = {}
	for i = 1, 12 do out[i] = self[i] + (other[i] - self[i]) * t end
	return setmetatable(out, cfmt)
end
function CF:ToEulerAnglesXYZ()
	local r02 = self[6]
	local r12, r22 = self[9], self[12]
	local r00, r01 = self[4], self[5]
	local r10, r11 = self[7], self[8]
	local sy = math.clamp(r02, -1, 1)
	local ry = math.asin(sy)
	if math.abs(sy) < 0.9999 then
		return math.atan2(-r12, r22), ry, math.atan2(-r01, r00)
	end
	return math.atan2(r11, r10), ry, 0
end
function CF:GetComponents()
	return self[1], self[2], self[3], self[4], self[5], self[6], self[7], self[8], self[9], self[10], self[11], self[12]
end
function CF:GetPivot() return self end
local CFrame = setmetatable({ new = CF.new, Angles = CF.Angles, lookAt = CF.lookAt,
	fromEulerAnglesXYZ = CF.fromEulerAnglesXYZ, fromEulerAnglesYXZ = CF.fromEulerAnglesYXZ,
	fromAxisAngle = CF.fromAxisAngle, fromMatrix = CF.fromMatrix, identity = CF.new() },
	{ __index = CF, __call = function(_, ...) return CF.new(...) end })

-- Color3
local C3 = {}
local c3mt = {
	__index = C3,
	__tostring = function(c) return string.format('%g, %g, %g', c.R, c.G, c.B) end,
	__eq = function(a, b) return a.R == b.R and a.G == b.G and a.B == b.B end,
	__mul = function(a, b)
		if type(b) == 'number' then return C3.new(a.R * b, a.G * b, a.B * b) end
		return C3.new(a.R * b.R, a.G * b.G, a.B * b.B)
	end,
	__add = function(a, b) return C3.new(a.R + b.R, a.G + b.G, a.B + b.B) end,
}
function C3.new(r, g, b) return setmetatable({ R = r or 0, G = g or 0, B = b or 0 }, c3mt) end
C3.fromRGB = function(r, g, b) return C3.new((r or 0) / 255, (g or 0) / 255, (b or 0) / 255) end
C3.fromHSV = function(h, s, v)
	local i = math.floor(h * 6)
	local f = h * 6 - i
	local p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
	i = i % 6
	local r, g, b
	if i == 0 then r, g, b = v, t, p
	elseif i == 1 then r, g, b = q, v, p
	elseif i == 2 then r, g, b = p, v, t
	elseif i == 3 then r, g, b = p, q, v
	elseif i == 4 then r, g, b = t, p, v
	else r, g, b = v, p, q end
	return C3.new(r, g, b)
end
function C3:ToHSV()
	local r, g, b = self.R, self.G, self.B
	local mx, mn = math.max(r, g, b), math.min(r, g, b)
	local v, d = mx, mx - mn
	local s = mx == 0 and 0 or d / mx
	local h = 0
	if d > 0 then
		if mx == r then h = (g - b) / d % 6
		elseif mx == g then h = (b - r) / d + 2
		else h = (r - g) / d + 4 end
		h = h / 6
	end
	return h, s, v
end
function C3:ToHex() return string.format('%02X%02X%02X', math.floor(self.R * 255 + .5), math.floor(self.G * 255 + .5), math.floor(self.B * 255 + .5)) end
C3.fromHex = function(h)
	h = h:gsub('#', '')
	return C3.new(tonumber(h:sub(1, 2), 16) / 255, tonumber(h:sub(3, 4), 16) / 255, tonumber(h:sub(5, 6), 16) / 255)
end
function C3:Lerp(o, t) return C3.new(self.R + (o.R - self.R) * t, self.G + (o.G - self.G) * t, self.B + (o.B - self.B) * t) end
local Color3 = { new = C3.new, fromRGB = C3.fromRGB, fromHSV = C3.fromHSV, fromHex = C3.fromHex,
	toHSV = function(c) return c:ToHSV() end }

-- UDim / UDim2
local UD = {}
local udmt = { __index = UD, __add = function(a, b) return setmetatable({ Scale = a.Scale + b.Scale, Offset = a.Offset + b.Offset }, getmetatable(a)) end }
function UD.new(s, o) return setmetatable({ Scale = s or 0, Offset = o or 0 }, udmt) end
local UDim = { new = UD.new }
local U2 = {}
local u2mt = { __index = U2 }
function U2.new(xs, xo, ys, yo)
	if type(ys) == 'table' then -- UDim2.new(UDim, UDim)
		ys, yo = xs and 0, 0
	end
	return setmetatable({ X = UD.new(xs or 0, xo or 0), Y = UD.new(ys or 0, yo or 0) }, u2mt)
end
U2.fromScale = function(x, y) return U2.new(x, 0, y, 0) end
U2.fromOffset = function(x, y) return U2.new(0, x, 0, y) end
local UDim2 = { new = U2.new, fromScale = U2.fromScale, fromOffset = U2.fromOffset }

-- BrickColor (podzbiór palety Robloxa: numer → {nazwa, r,g,b})
local BRICK = {
	[1] = { 'White', 242, 243, 243 }, [2] = { 'Grey', 161, 165, 162 }, [3] = { 'Light yellow', 249, 233, 153 },
	[5] = { 'Brick yellow', 215, 197, 154 }, [6] = { 'Light green (Mint)', 194, 218, 184 },
	[9] = { 'Light reddish violet', 232, 186, 200 }, [11] = { 'Pastel Blue', 128, 187, 219 },
	[12] = { 'Light orange brown', 203, 132, 66 }, [18] = { 'Nougat', 204, 142, 105 },
	[21] = { 'Bright red', 196, 40, 28 }, [23] = { 'Bright blue', 13, 105, 172 },
	[24] = { 'Bright yellow', 245, 205, 48 }, [26] = { 'Black', 27, 42, 53 },
	[28] = { 'Dark green', 40, 127, 71 }, [29] = { 'Bright green', 75, 151, 75 },
	[36] = { 'Light orange', 224, 178, 118 }, [37] = { 'Bright violet', 73, 44, 134 },
	[38] = { 'Bright orange', 218, 133, 65 }, [45] = { 'Light blue', 180, 210, 228 },
	[100] = { 'Lavender', 176, 142, 186 }, [101] = { 'Medium red', 218, 133, 121 },
	[102] = { 'Medium blue', 110, 153, 202 }, [104] = { 'Bright violet', 107, 50, 124 },
	[105] = { 'Br. yellowish orange', 226, 155, 64 }, [106] = { 'Bright orange', 218, 133, 65 },
	[107] = { 'Bright bluish green', 0, 143, 156 }, [108] = { 'Earth yellow', 203, 175, 123 },
	[110] = { 'Bright bluish violet', 85, 96, 158 }, [119] = { 'Br. yellowish green', 164, 189, 71 },
	[135] = { 'Sand blue', 116, 134, 157 }, [141] = { 'Earth green', 40, 94, 67 },
	[151] = { 'Sand green', 120, 144, 130 }, [192] = { 'Reddish brown', 105, 64, 40 },
	[194] = { 'Medium stone grey', 163, 162, 165 }, [199] = { 'Dark stone grey', 99, 95, 98 },
	[208] = { 'Light stone grey', 228, 236, 241 }, [217] = { 'Brown', 124, 92, 70 },
	[226] = { 'Bright yellow', 253, 234, 141 }, [268] = { 'Really black', 18, 20, 22 },
	[1004] = { 'Really red', 255, 0, 0 }, [1005] = { 'Really blue', 0, 0, 255 },
	[1006] = { 'Really white', 255, 255, 255 }, [1008] = { 'Really green', 21, 176, 65 },
	[1030] = { 'Pastel brown', 255, 204, 153 }, [1032] = { 'Bright purple', 255, 0, 191 },
}
local BC = {}
BC.__index = BC
local function brickFromNumber(n) return BRICK[math.floor(n or 194)] or BRICK[194] end
function BC.new(v, g, b)
	local num = 194
	if type(v) == 'number' then num = v
	elseif type(v) == 'string' then
		for k, val in pairs(BRICK) do if val[1]:lower() == v:lower() then num = k break end end
		if v:lower() == 'really red' then num = 1004 elseif v:lower() == 'really black' then num = 268 end
	elseif getmetatable(v) == c3mt then
		-- najbliższy kolor z palety
		local best, bestd = 194, math.huge
		for k, val in pairs(BRICK) do
			local d = (val[2] / 255 - v.R) ^ 2 + (val[3] / 255 - v.G) ^ 2 + (val[4] / 255 - v.B) ^ 2
			if d < bestd then best, bestd = k, d end
		end
		num = best
	elseif v == nil then num = 194
	end
	local d = brickFromNumber(num)
	return setmetatable({ Number = num, Name = d[1], Color = C3.fromRGB(d[2], d[3], d[4]) }, BC)
end
function BC:__tostring() return string.format('%s (%d)', self.Name, self.Number) end
BC.Random = function() local ks = {} for k in pairs(BRICK) do ks[#ks + 1] = k end return BC.new(ks[math.random(#ks)]) end
local BrickColor = setmetatable({ new = BC.new, palette = function() local t = {} for k, v in pairs(BRICK) do t[#t + 1] = k end table.sort(t) return t end },
	{ __index = function(_, k)
		for _, v in pairs(BRICK) do if v[1]:lower() == k:lower():gsub(' ', '') then return BC.new(v and 1) end end
		return nil
	end })
setmetatable(BrickColor, { __index = function(_, k)
	local map = { Red = 21, BrightRed = 21, Blue = 23, BrightBlue = 23, Yellow = 24, BrightYellow = 24,
		Green = 28, DarkGreen = 28, White = 1, Black = 26, ReallyBlack = 268, MediumStoneGrey = 194,
		DarkStoneGrey = 199, LightStoneGrey = 208, Brown = 217, ReddishBrown = 192, Grey = 2, BrightGreen = 29 }
	return map[k] and BC.new(map[k]) or nil
end })

-- Enum
local ENUM_DEFS = {
	Material = { Plastic = 256, SmoothPlastic = 272, Neon = 288, Wood = 512, WoodPlanks = 528, Marble = 784,
		Slate = 800, Concrete = 816, Granite = 832, Brick = 848, Pebble = 864, Cobblestone = 880,
		CorrodedMetal = 1040, DiamondPlate = 1056, Foil = 1072, Metal = 1088, Grass = 1280,
		Sand = 1296, Fabric = 1312, Ice = 1536, Glass = 1568 },
	PartType = { Ball = 0, Block = 1, Cylinder = 2, Wedge = 3, CornerWedge = 4 },
	NormalId = { Right = 0, Top = 1, Back = 2, Left = 3, Bottom = 4, Front = 5 },
	EasingStyle = { Linear = 0, Sine = 1, Back = 2, Quad = 3, Quart = 4, Quint = 5, Bounce = 6,
		Elastic = 7, Exponential = 8, Cubic = 9, Circular = 10 },
	EasingDirection = { In = 0, Out = 1, InOut = 2 },
	HumanoidStateType = { FallingDown = 0, Running = 1, RunningNoPhysics = 2, Jumping = 3, Freefall = 4,
		Walking = 5, Swimming = 6, StrafingNoPhysics = 7, Climbing = 8, Seated = 9, Dead = 10 },
	HumanoidRigType = { R6 = 0, R15 = 1 },
	KeyCode = { Space = 32, Enter = 13, Escape = 27, Unknown = 0, W = 87, A = 65, S = 83, D = 68,
		E = 69, F = 70, Q = 81, R = 82, C = 67, X = 88, Z = 90, One = 49, Two = 50, Three = 51,
		LeftShift = 304, LeftControl = 306, LeftAlt = 308, Tab = 9, Backspace = 8, Up = 273,
		Down = 274, Left = 276, Right = 275 },
	UserInputType = { Keyboard = 0, MouseButton1 = 1, MouseButton2 = 2, Touch = 3, MouseMovement = 4 },
	MouseButton = { Left = 0, Right = 1, Middle = 2 },
	PlayState = { Begin = 0, Pause = 1, Resume = 2, End = 3 },
	CameraType = { Fixed = 0, Attach = 1, Watch = 2, Track = 3, Follow = 4, Custom = 5, Scriptable = 6, Orbit = 7 },
	RaycastFilterType = { Exclude = 0, Include = 1 },
	TextXAlignment = { Left = 0, Right = 1, Center = 2 },
	TextYAlignment = { Top = 0, Center = 1, Bottom = 2 },
	Font = { Legacy = 0, Arial = 1, SourceSans = 2, Gotham = 3, GothamBold = 4, Cartoon = 5, Code = 6, Highways = 7, SciFi = 8, Arcade = 9, Fantasy = 10, Antique = 11, GothamSemibold = 12, Monospace = 20 },
	SizeConstraint = { RelativeXY = 0, RelativeXX = 1, RelativeYY = 2 },
	FillDirection = { Horizontal = 0, Vertical = 1 },
	HorizontalAlignment = { Center = 0, Left = 1, Right = 2 },
	VerticalAlignment = { Center = 0, Top = 1, Bottom = 2 },
	ScaleType = { Stretch = 0, Slice = 1, Tile = 2, Fit = 3, Crop = 4 },
	ApplyStrokeMode = { Contextual = 0, Border = 1 },
	BorderSizePixel = {},
	TweenStatus = { Canceled = 0, Completed = 1 },
	RaycastFilterType2 = {},
	ProximityPromptStyle = { Default = 0, Custom = 1 },
	ResamplerMode = { Default = 0, Pixelated = 1 },
	SoundType = { NoSound = 0, Boing = 1, Bomb = 2, Click = 3, Snap = 4, Splat = 5, Step = 6, StepOn = 7, Swoosh = 8, Victory = 9 },
	HttpContentType = { ApplicationJson = 0 },
	AutomaticSize = { None = 0, X = 1, Y = 2, XY = 3 },
	ThumbnailType = { HeadShot = 0, AvatarBust = 1, AvatarFullBody = 2 },
}
local Enum = {}
local ENUM_ITEMS = {}
local EnumItemMT = { __tostring = function(s) return 'Enum.' .. tostring(s.EnumType) .. '.' .. s.Name end,
	__eq = function(a, b) return a.EnumType == b.EnumType and a.Value == b.Value end }
local function makeEnumItem(typeName, name, value)
	return setmetatable({ Name = name, Value = value, EnumType = typeName, __isEnumItem = true }, EnumItemMT)
end
local function buildEnum(typeName)
	local def = ENUM_DEFS[typeName] or {}
	local byName, byValue = {}, {}
	for name, value in pairs(def) do
		local item = makeEnumItem(typeName, name, value)
		byName[name] = item
		byValue[value] = item
	end
	ENUM_ITEMS[typeName] = { byName, byValue }
end
local function enumItem(typeName, value)
	if not ENUM_ITEMS[typeName] then buildEnum(typeName) end
	return ENUM_ITEMS[typeName][2][value] or makeEnumItem(typeName, 'Unknown', value)
end
local function enumType(typeName)
	if not ENUM_ITEMS[typeName] then buildEnum(typeName) end
	local e = ENUM_ITEMS[typeName]
	return setmetatable({ _items = e[1], _byValue = e[2], _typeName = typeName }, {
		__index = e[1],
		__newindex = function() error('Enum jest tylko do odczytu') end,
	})
end
setmetatable(Enum, { __index = function(_, k) return enumType(k) end })
function Enum.GetEnums()
	local out = {}
	for k in pairs(ENUM_DEFS) do out[#out + 1] = enumType(k) end
	return out
end

-- TweenInfo
local TI = {}
TI.__index = TI
local function tweenInfo(props)
	local style = props.EasingStyle
	local dir = props.EasingDirection
	if type(style) == 'number' then style = enumItem('EasingStyle', style) end
	if type(dir) == 'number' then dir = enumItem('EasingDirection', dir) end
	local t = { Time = props.Time or 1,
		EasingStyle = style or enumItem('EasingStyle', 0),
		EasingDirection = dir or enumItem('EasingDirection', 1),
		RepeatCount = props.RepeatCount or 0, Reverses = props.Reverses or false, DelayTime = props.DelayTime or 0 }
	return setmetatable(t, TI)
end
local TweenInfo = { new = function(time, style, dir, repeatCount, reverses, delayTime)
	return tweenInfo({ Time = time,
		EasingStyle = style and (style.Value or style) or 0,
		EasingDirection = dir and (dir.Value or dir) or 1,
		RepeatCount = repeatCount or 0, Reverses = reverses or false, DelayTime = delayTime or 0 })
end }

-- Ray
local Ray = {}
Ray.new = function(origin, direction) return { Origin = origin, Direction = direction } end

-- NumberRange / NumberSequence / ColorSequence
local NumberRange = { new = function(a, b) return { Min = a, Max = b or a } end }
local NumberSequence = { new = function(a, b) return { Keypoints = type(a) == 'table' and a or { a, b } } end }
local NumberSequenceKeypoint = { new = function(t, v, e) return { Time = t, Value = v, Envelope = e or 0 } end }
local ColorSequence = { new = function(a, b) return { Keypoints = type(a) == 'table' and a or { a, b } } end }
local ColorSequenceKeypoint = { new = function(t, c, e) return { Time = t, Value = c, Envelope = e or 0 } end }

-- Random
local Random = {}
Random.__index = Random
Random.new = function(seed)
	math.randomseed(seed or os.time())
	return setmetatable({ _s = seed or 0 }, Random)
end
function Random:NextNumber(a, b)
	if a == nil then return math.random() end
	return a + (b - a) * math.random()
end
function Random:NextInteger(a, b) return math.random(a, b) end
function Random:Clone() return Random.new(self._s) end

-- DateTime (minimalny)
local DateTime = {}
DateTime.now = function() return { UnixTimestamp = os.time(), UnixTimestampMillis = os.time() * 1000,
	__tostring = function() return os.date('%Y-%m-%dT%H:%M:%SZ') end } end
DateTime.fromUnixTimestamp = function(t) return { UnixTimestamp = t, ToIsoDate = function(self) return os.date('!%Y-%m-%dT%H:%M:%SZ', t) end } end

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Scheduler zadań (odpowiednik task.* i korutyn Robloxa)
-- ─────────────────────────────────────────────────────────────────────────────
local TIMERS = {}   -- { at = number, co = coroutine, args = {...} }
local defers = {}   -- funkcje do uruchomienia na końcu ticku

local function resumeThread(co, ...)
	local ok, yielded = coroutine.resume(co, ...)
	if not ok then
		host.log('error', 'Błąd w skrypcie: ' .. tostring(yielded))
		return
	end
	if coroutine.status(co) ~= 'dead' and type(yielded) == 'table' then
		if yielded.wait then
			TIMERS[#TIMERS + 1] = { at = now() + math.max(yielded.wait or 0, 0), co = co }
		elseif yielded.event then
			subscribeWaiter(yielded.event, co)
		end
	end
end

local task = {}
function task.spawn(fn, ...)
	local co
	if type(fn) == 'thread' then co = fn else co = coroutine.create(fn) end
	resumeThread(co, ...)
	return co
end
function task.defer(fn, ...) defers[#defers + 1] = { fn = fn, args = { ... } } end
function task.delay(t, fn, ...)
	local co = coroutine.create(fn)
	TIMERS[#TIMERS + 1] = { at = now() + (t or 0), co = co, args = { ... } }
	return co
end
function task.wait(t)
	if not t or t <= 0 then
		coroutine.yield({ wait = 0 })
	else
		coroutine.yield({ wait = t })
	end
end
function task.cancel(co) for i = #TIMERS, 1, -1 do if TIMERS[i].co == co then table.remove(TIMERS, i) end end end
function task.synchronize(fn, ...) return fn(...) end
function task.desynchronize(fn, ...) return fn(...) end
-- aliasy globalne (starsze skrypty)
wait = task.wait
spawn = function(fn, ...) return task.spawn(fn, ...) end
delay = function(t, fn, ...) return task.delay(t, fn, ...) end
tick = function() return now() end
time = function() return now() end
pcall(function() os.clock = function() return now() end end)
elapsedTime = function() return now() end

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Sygnały (eventy)
-- ─────────────────────────────────────────────────────────────────────────────
local SIGNALS = {}      -- key -> { handlers = {fn...}, waiters = {co...} }
local WAITERS = {}      -- key -> { co... } (dla :Wait())

local function signalFor(key)
	local s = SIGNALS[key]
	if not s then s = { handlers = {}, waiters = {} }; SIGNALS[key] = s end
	return s
end
subscribeWaiter = function(key, co)
	local s = signalFor(key)
	s.waiters[#s.waiters + 1] = co
end

local Connection = {}
Connection.__index = Connection
function Connection:Disconnect()
	self.Connected = false
	local list = self.signal.handlers
	for i = #list, 1, -1 do if list[i] == self then table.remove(list, i) end end
end
function Connection:disconnect() self:Disconnect() end
Connection.__tostring = function() return 'Connection' end

local Signal = {}
Signal.__index = Signal
function Signal.new(key, name)
	return setmetatable({ key = key, name = name or key, handlers = {}, _isSignal = true }, Signal)
end
function Signal:Connect(fn)
	if type(fn) ~= 'function' then error('Connect oczekuje funkcji') end
	local conn = setmetatable({ signal = self, fn = fn, Connected = true }, Connection)
	table.insert(self.handlers, conn)
	local s = signalFor(self.key)
	s.handlers[#s.handlers + 1] = conn
	return conn
end
Signal.connect = Signal.Connect
function Signal:Once(fn)
	local conn
	conn = self:Connect(function(...)
		conn:Disconnect()
		fn(...)
	end)
	return conn
end
function Signal:Wait()
	coroutine.yield({ event = self.key })
	local pending = signalFor(self.key)._lastArgs
	return table.unpack(pending or {})
end
function Signal:Fire(...)
	dispatchSignal(self.key, { ... })
end

function dispatchSignal(key, args)
	local s = SIGNALS[key]
	if not s then return end
	local passed = args or {}
	s._lastArgs = passed
	-- oczekujący :Wait()
	if #s.waiters > 0 then
		local ws = s.waiters
		s.waiters = {}
		for _, co in ipairs(ws) do resumeThread(co, table.unpack(passed)) end
	end
	-- podłączeni słuchacze uruchamiani są w nowym wątku (mogą yieldować)
	local conns = {}
	for i, c in ipairs(s.handlers) do conns[i] = c end
	for _, conn in ipairs(conns) do
		if conn.Connected then
			local co = coroutine.create(conn.fn)
			resumeThread(co, table.unpack(passed))
		end
	end
end

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Instancje
-- ─────────────────────────────────────────────────────────────────────────────
local INST_TABLE = {}     -- id -> obiekt Lua
local instanceTable -- forward declaration (definicja niżej)
local SIGNAL_OF_CLASS = {
	Instance = { 'Changed', 'ChildAdded', 'ChildRemoved', 'DescendantAdded', 'DescendantRemoving',
		'AncestryChanged', 'AttributeChanged', 'Destroying' },
	Part = { 'Touched', 'TouchEnded' },
	BasePart = { 'Touched', 'TouchEnded' },
	Humanoid = { 'Died', 'HealthChanged', 'StateChanged', 'Running', 'Jumping', 'Landed', 'MoveToFinished', 'Seated', 'Climbing' },
	Player = { 'CharacterAdded', 'CharacterRemoving', 'Chatted', 'Died', 'Idled' },
	Players = { 'PlayerAdded', 'PlayerRemoving', 'PlayerChatting' },
	RunService = { 'Heartbeat', 'Stepped', 'RenderStepped' },
	Tool = { 'Equipped', 'Unequipped', 'Activated', 'Deactivated' },
	GuiObject = { 'MouseButton1Click', 'MouseButton1Down', 'MouseButton1Up', 'MouseEnter', 'MouseLeave', 'Activated', 'InputBegan', 'InputEnded' },
	TextButton = { 'MouseButton1Click', 'Activated', 'MouseEnter', 'MouseLeave' },
	ClickDetector = { 'MouseClick' },
	RemoteEvent = { 'OnServerEvent', 'OnClientEvent', 'OnServerInvoke', 'OnClientInvoke' },
	BindableEvent = { 'Event' },
	BindableFunction = { 'OnInvoke' },
	BasePart2 = {},
	Sound = { 'Played', 'Ended', 'Loaded', 'Stopped' },
	Model = { 'PrimaryPartSet' },
	ProximityPrompt = { 'Triggered', 'TriggerEnded' },
}

local ALL_SIGNAL_NAMES = { Changed = true, AncestryChanged = true, Destroying = true }
for _, list in pairs(SIGNAL_OF_CLASS) do for _, n in ipairs(list) do ALL_SIGNAL_NAMES[n] = true end end

-- Pola dopisane do instancji po stronie Luau (np. RunService.IsServer = function() ... end)
local LUA_MEMBERS = {}

local function signalKeyFor(id, name) return 'i' .. id .. ':sig:' .. name end

local INST_CLASS_PARENT = {
	Part = 'BasePart', WedgePart = 'BasePart', MeshPart = 'BasePart', CornerWedgePart = 'BasePart',
	TrussPart = 'BasePart', SpawnLocation = 'BasePart', Seat = 'BasePart', VehicleSeat = 'BasePart',
	BasePart = 'Instance', Model = 'Instance', Script = 'BaseScript', LocalScript = 'BaseScript',
	ModuleScript = 'Instance', BaseScript = 'Instance', Folder = 'Instance', Humanoid = 'Instance',
	TextLabel = 'GuiObject', TextButton = 'GuiObject', Frame = 'GuiObject', ScreenGui = 'LayerCollector',
	LayerCollector = 'LayerCollector', BillboardGui = 'LayerCollector', Sound = 'Instance',
	RemoteEvent = 'Instance', BindableEvent = 'Instance', BindableFunction = 'Instance',
	ClickDetector = 'Instance', Camera = 'Instance', Player = 'Instance', Players = 'Instance',
	RunService = 'Instance', Lighting = 'Instance', Workspace = 'Instance', Tool = 'BackpackItem',
}

local function classSignals(className)
	local out = {}
	local c = className
	local seen = {}
	while c do
		local s = SIGNAL_OF_CLASS[c]
		if s then for _, n in ipairs(s) do if not seen[n] then seen[n] = true; out[#out + 1] = n end end end
		c = INST_CLASS_PARENT[c]
	end
	return out
end

-- Konwersje wartości między JS (liczby/stringi/tablice) a DataTypami
local V3_PROPS = { Size = true, Position = true, Velocity = true, AssemblyLinearVelocity = true,
	AssemblyAngularVelocity = true, Orientation = true, Origin = true, Direction = true,
	WorldPivotPosition = true, HipHeight = true, CameraOffset = true, Velocity2 = true }
local C3_PROPS = { Color = true, Color3 = true, BackgroundColor3 = true, TextColor3 = true,
	BorderColor3 = true, TextStrokeColor3 = true, Color3Value = true, HealthDisplayDistance = false }
local ENUM_PROPS = { Material = 'Material', Shape = 'PartType', EasingStyle = 'EasingStyle',
	EasingDirection = 'EasingDirection', Font = 'Font', TextXAlignment = 'TextXAlignment',
	TextYAlignment = 'TextYAlignment', ScaleType = 'ScaleType', FillDirection = 'FillDirection',
	HorizontalAlignment = 'HorizontalAlignment', VerticalAlignment = 'VerticalAlignment',
	SizeConstraint = 'SizeConstraint', ApplyStrokeMode = 'ApplyStrokeMode', AutomaticSize = 'AutomaticSize' }

local function toRaw(key, value)
	if value == nil then return nil end
	if type(value) == 'number' or type(value) == 'string' or type(value) == 'boolean' then return value end
	local mt = getmetatable(value)
	if mt == v3mt then return { value.X, value.Y, value.Z } end
	if mt == v2mt then return { value.X, value.Y } end
	if mt == cfmt then local t = {} for i = 1, 12 do t[i] = value[i] end return t end
	if mt == c3mt then return { value.R, value.G, value.B } end
	if mt == udmt then return { value.Scale, value.Offset } end
	if getmetatable(value) == u2mt then
		return { value.X.Scale, value.X.Offset, value.Y.Scale, value.Y.Offset }
	end
	if value.__isEnumItem then return value.Value end
	if value.Number and value.Color and value.Name then return value.Number end -- BrickColor
	if value.Origin and value.Direction then return { value.Origin.X, value.Origin.Y, value.Origin.Z, value.Direction.X, value.Direction.Y, value.Direction.Z } end
	if value.Min ~= nil and value.Max ~= nil then return { value.Min, value.Max } end
	if value.Keypoints then
		-- serializujemy keypointy jako płaską tablicę liczb (wystarczy do interpolacji)
		local t = {}
		for _, kp in ipairs(value.Keypoints) do
			if kp.Value and type(kp.Value) == 'table' and kp.Value.R then
				t[#t + 1] = kp.Time; t[#t + 1] = kp.Value.R; t[#t + 1] = kp.Value.G; t[#t + 1] = kp.Value.B; t[#t + 1] = kp.Envelope or 0
			else
				t[#t + 1] = kp.Time; t[#t + 1] = kp.Value; t[#t + 1] = kp.Envelope or 0
			end
		end
		return t
	end
	if type(value) == 'table' and value.__id then return '@' .. value.__id end
	if type(value) == 'table' then
		local n = #value
		if n > 0 then
			local out = {}
			for i = 1, n do out[i] = toRaw(key, value[i]) end
			return out
		end
		return RBX_JSON.encode(value)
	end
	return nil
end

local function fromRaw(key, raw)
	if raw == nil then return nil end
	if type(raw) == 'string' and raw:sub(1, 1) == '@' then
		local id = tonumber(raw:sub(2))
		if id then return INST_TABLE[id] or instanceTable(id, host.getClassName(id)) end
	end
	if type(raw) == 'table' and raw.r00 ~= nil then
		return setmetatable({ raw.x or 0, raw.y or 0, raw.z or 0, raw.r00, raw.r01, raw.r02,
			raw.r10, raw.r11, raw.r12, raw.r20, raw.r21, raw.r22 }, cfmt)
	end
	if key == 'CFrame' or key == 'Pivot' then
		return CFrame.new(0, 0, 0)
	end
	if V3_PROPS[key] and type(raw) == 'table' and raw.x ~= nil then return V3.new(raw.x, raw.y, raw.z) end
	if C3_PROPS[key] and type(raw) == 'table' and raw.x ~= nil then return C3.new(raw.x, raw.y, raw.z) end
	if key == 'BrickColor' then return BC.new(raw) end
	if ENUM_PROPS[key] then return enumItem(ENUM_PROPS[key], raw) end
	if key == 'Parent' then
		if not raw then return nil end
		return INST_TABLE[raw] or instanceTable(raw, host.getClassName(raw))
	end
	if type(raw) == 'table' then
		return raw
	end
	return raw
end

-- Metody instancji wspólne dla wszystkich klas
local METHODS = {}
function METHODS.Destroy(self)
	local id = self.__id
	dispatchSignal(signalKeyFor(id, 'Destroying'), {})
	host.destroy(id)
	INST_TABLE[id] = nil
end
METHODS.Remove = METHODS.Destroy
METHODS.remove = METHODS.Destroy
function METHODS.Clone(self)
	local newId = host.clone(self.__id)
	if not newId then return nil end
	return instanceTable(newId, host.getClassName(newId))
end
function METHODS.FindFirstChild(self, name, recursive)
	local id = host.findChild(self.__id, name, recursive or false)
	if not id then return nil end
	return instanceTable(id, host.getClassName(id))
end
function METHODS.FindFirstChildOfClass(self, class, rec)
	local id = host.findFirstChildOfClass(self.__id, class, rec or false)
	if not id then return nil end
	return instanceTable(id, host.getClassName(id))
end
function METHODS.FindFirstChildWhichIsA(self, class, rec) return METHODS.FindFirstChildOfClass(self, class, rec) end
function METHODS.WaitForChild(self, name, timeout)
	local found = host.findChild(self.__id, name, false)
	if found then return instanceTable(found, host.getClassName(found)) end
	local t0 = now()
	while now() - t0 < (timeout or 60) do
		task.wait(0.03)
		found = host.findChild(self.__id, name, false)
		if found then return instanceTable(found, host.getClassName(found)) end
	end
	error('WaitForChild: nie znaleziono ' .. tostring(name))
end
function METHODS.GetChildren(self)
	local out = {}
	local ids = RBX_JSON.decode(host.getChildren(self.__id)) or {}
	for _, id in ipairs(ids) do out[#out + 1] = instanceTable(id, host.getClassName(id)) end
	return out
end
function METHODS.GetDescendants(self)
	local out = {}
	local function walk(id)
		for _, cid in ipairs(RBX_JSON.decode(host.getChildren(id)) or {}) do
			out[#out + 1] = instanceTable(cid, host.getClassName(cid))
			walk(cid)
		end
	end
	walk(self.__id)
	return out
end
function METHODS.GetFullName(self) return host.fullName(self.__id) end
function METHODS.IsA(self, class)
	local c = self.ClassName
	while c do
		if c == class then return true end
		c = INST_CLASS_PARENT[c]
	end
	return class == 'Instance'
end
function METHODS.IsDescendantOf(self, other)
	local p = host.getParent(self.__id)
	while p do
		if p == other.__id then return true end
		p = host.getParent(p)
	end
	return false
end
function METHODS.GetAttribute(self, name) return fromRaw(name, host.getAttribute(self.__id, name)) end
function METHODS.SetAttribute(self, name, value)
	host.setAttribute(self.__id, name, toRaw(name, value))
	dispatchSignal(signalKeyFor(self.__id, 'AttributeChanged'), { name })
end
function METHODS.GetAttributes(self) return RBX_JSON.decode(host.getAttributes(self.__id) or '{}') or {} end
function METHODS.HasTag(self, tag) return host.hasTag(self.__id, tag) end
function METHODS.AddTag(self, tag) host.addTag(self.__id, tag) end
function METHODS.RemoveTag(self, tag) host.removeTag(self.__id, tag) end
function METHODS.GetTags(self) return host.getTags(self.__id) or {} end
function METHODS.SetPrimaryPartCFrame(self, cf)
	local base = self.CFrame or CFrame.new()
	local delta = cf * base:Inverse()
	for _, child in ipairs(METHODS.GetChildren(self)) do
		if child.CFrame then child.CFrame = delta * child.CFrame end
	end
	self.CFrame = cf
end
METHODS.PivotTo = function(self, cf) self:SetPrimaryPartCFrame(cf) end
function METHODS.GetPivot(self) return self.CFrame or CFrame.new() end
function METHODS.GetPropertyChangedSignal(self, key)
	local sig = signalFor('i' .. self.__id .. ':pc:' .. key)
	if not sig._signal then sig._signal = Signal.new('i' .. self.__id .. ':pc:' .. key, key) end
	return sig._signal
end
function METHODS.GetAttributeChangedSignal(self, key)
	local sig = signalFor('i' .. self.__id .. ':attr:' .. key)
	if not sig._signal then sig._signal = Signal.new('i' .. self.__id .. ':attr:' .. key, key) end
	return sig._signal
end
function METHODS.GetChildrenChangedSignal(self) return self.ChildAdded end
function METHODS.GetDebugId(self) return self.__id end
function METHODS.getChildren(self) return METHODS.GetChildren(self) end
function METHODS.IsLoaded(self) return true end
function METHODS.Clone2(self) end

-- metoda `Wait` dla sygnałów jest w Signal; instancje mają dodatkowo: IsA itd.

local InstanceMT = {}

function instanceTable(id, className)
	local obj = INST_TABLE[id]
	if obj then return obj end
	obj = setmetatable({ __id = id, __class = className or host.getClassName(id) }, InstanceMT)
	INST_TABLE[id] = obj
	return obj
end

local KNOWN_PROPS = {
	Name = true, Parent = true, Size = true, CFrame = true, Position = true, Orientation = true,
	Color = true, BrickColor = true, Color3 = true, Material = true, Transparency = true,
	Reflectance = true, Anchored = true, CanCollide = true, CanTouch = true, CanQuery = true,
	CastShadow = true, Shape = true, Locked = true, Massless = true, Velocity = true,
	AssemblyLinearVelocity = true, AssemblyAngularVelocity = true, RotVelocity = true,
	Health = true, MaxHealth = true, WalkSpeed = true, JumpPower = true, JumpHeight = true,
	UseJumpPower = true, DisplayName = true, Text = true, TextScaled = true, TextColor3 = true,
	TextSize = true, TextStrokeTransparency = true, BackgroundColor3 = true, BackgroundTransparency = true,
	Visible = true, Enabled = true, Value = true, Source = true, Disabled = true, Image = true,
	ClipsDescendants = true, BorderSizePixel = true, ZIndex = true, LayoutOrder = true, Font = true,
	TextXAlignment = true, TextYAlignment = true, Rotation = true, SoundId = true, Volume = true,
	Playing = true, TimePosition = true, Looped = true, Speed = true, Brightness = true, Ambient = true,
	ColorShift_Top = true, OutdoorAmbient = true, ClockTime = true, FogEnd = true, FogStart = true,
	FogColor = true, FieldOfView = true, CameraType = true, CameraSubject = true, Gravity = true,
	Character = true, Camera = true, PrimaryPart = true, UserId = true, TeamColor = true,
	AccountAge = true, FollowUserId = true, Archivable = true, WalkSpeed2 = true,
	MaxSlopeAngle = true, HipHeight = true, HeadScale = true, BodyDepthScale = true,
	Owner = true, Active = true, RequiresHandle = true, ToolTip = true, CanBeDropped = true,
	Backpack = true, PlayerGui = true, leaderstats = true, DevCameraOcclusionMode = true,
	DevComputerCameraMode = true, DevComputerMovementMode = true, AutoJumpEnabled = true,
	CameraMaxZoomDistance = true, CameraMinZoomDistance = true, CameraMode = true,
	LoadCharacterAppearance = true, CharacterAutoLoads = true, RespawnTime = true,
	MaxPlayers = true, PlaceId = true, GameId = true, IsPlayer = true, Dead = true,
	MoveToPosition = true, MoveToActive = true, State = true, Jump = true, Sit = true,
	ShoulderOffset = true, ResolutionScale = true, QualityLevel = true, StreamingEnabled = true,
	ColorCorrectionEffect = true, TextLabel = true, UIScale = true, Padding = true,
}

local GUI_CLASSES = { Frame = true, TextLabel = true, TextButton = true, ImageLabel = true,
	ImageButton = true, ScrollingFrame = true, TextBox = true, ViewportFrame = true, ScreenGui = true,
	SurfaceGui = true, BillboardGui = true, UIListLayout = true, UICorner = true, UIPadding = true, UIStroke = true }

InstanceMT.__index = function(self, key)
	local id = rawget(self, '__id')
	if not id then return nil end
	local className = rawget(self, '__class')
	-- pola dopisane w Luau mają priorytet
	local members = LUA_MEMBERS[id]
	if members and members[key] ~= nil then return members[key] end
	local m = METHODS[key]
	if m then return m end
	if key == 'ClassName' then return className end
	-- sygnały
	if ALL_SIGNAL_NAMES[key] then
		local sigKey = signalKeyFor(id, key)
		local s = signalFor(sigKey)
		if not s._signal then s._signal = Signal.new(sigKey, key) end
		return s._signal
	end
	if key == 'Parent' then
		local p = host.getParent(id)
		if not p then return nil end
		return INST_TABLE[p] or instanceTable(p, host.getClassName(p))
	end
	-- DataModel: game.Workspace działa jak właściwość
	if className == 'DataModel' then
		local cid = host.findChild(id, key, false)
		if cid then return instanceTable(cid, host.getClassName(cid)) end
	end
	if key == 'Position' and className ~= 'DataModel' then
		local cf = fromRaw('CFrame', host.getProp(id, 'CFrame'))
		if cf then return V3.new(cf[1], cf[2], cf[3]) end
	end
	if key == 'Orientation' then
		local cf = fromRaw('CFrame', host.getProp(id, 'CFrame'))
		if cf then
			local rx, ry, rz = cf:ToEulerAnglesXYZ()
			return V3.new(math.deg(rx), math.deg(ry), math.deg(rz))
		end
	end
	if key == 'Velocity' then
		local v = host.getProp(id, 'AssemblyLinearVelocity')
		if type(v) == 'table' and v.x ~= nil then return V3.new(v.x, v.y, v.z) end
	end
	local raw = host.getProp(id, key)
	if raw == nil then
		-- w Robloxie można odwołać się do dziecka po nazwie: player.leaderstats
		local cid = host.findChild(id, key, false)
		if cid then return instanceTable(cid, host.getClassName(cid)) end
		return nil
	end
	-- GUI: Position/Size to UDim2
	if GUI_CLASSES[className] and (key == 'Position' or key == 'Size' or key == 'AnchorPoint') then
		if type(raw) == 'table' and raw.a ~= nil then
			return U2.new(raw.a, raw.b, raw.c, raw.d)
		end
		if type(raw) == 'table' and raw.x ~= nil then return V2.new(raw.x, raw.y) end
	end
	return fromRaw(key, raw)
end

InstanceMT.__newindex = function(self, key, value)
	local id = rawget(self, '__id')
	if not id then rawset(self, key, value) return end
	if key == 'Parent' then
		host.setParent(id, value and value.__id or nil)
		dispatchSignal(signalKeyFor(id, 'AncestryChanged'), { self })
		return
	end
	local className = rawget(self, '__class')
	-- pochodne transformacji
	if key == 'Position' and getmetatable(value) == v3mt then
		local c = fromRaw('CFrame', host.getProp(id, 'CFrame')) or CF.new()
		local newCf = { value.X, value.Y, value.Z, c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12] }
		host.setProp(id, 'CFrame', newCf, true)
		dispatchSignal('i' .. id .. ':pc:CFrame', { CFrame.new(table.unpack(newCf)) })
		dispatchSignal('i' .. id .. ':pc:Position', { value })
		dispatchSignal(signalKeyFor(id, 'Changed'), { 'Position' })
		return
	end
	if key == 'Orientation' and getmetatable(value) == v3mt then
		local c = fromRaw('CFrame', host.getProp(id, 'CFrame')) or CF.new()
		local rot = CF.Angles(math.rad(value.X), math.rad(value.Y), math.rad(value.Z))
		local newCf = { c[1], c[2], c[3], rot[4], rot[5], rot[6], rot[7], rot[8], rot[9], rot[10], rot[11], rot[12] }
		host.setProp(id, 'CFrame', newCf, true)
		dispatchSignal('i' .. id .. ':pc:CFrame', { CFrame.new(table.unpack(newCf)) })
		dispatchSignal(signalKeyFor(id, 'Changed'), { 'Orientation' })
		return
	end
	if type(value) == 'function' or (type(value) == 'table' and rawget(value, '__id')) then
		-- funkcje oraz referencje do innych instancji trzymamy po stronie Luau
		LUA_MEMBERS[id] = LUA_MEMBERS[id] or {}
		LUA_MEMBERS[id][key] = value
		return
	end
	local raw = toRaw(key, value)
	local isKnown = KNOWN_PROPS[key] or host.getProp(id, key) ~= nil
	if raw == nil and not isKnown then
		-- nieznane pole: trzymamy lokalnie (jak tag), nie zaśmiecamy modelu
		LUA_MEMBERS[id] = LUA_MEMBERS[id] or {}
		LUA_MEMBERS[id][key] = value
		return
	end
	if GUI_CLASSES[className] and (key == 'Position' or key == 'Size') and getmetatable(value) == u2mt then
		raw = { value.X.Scale, value.X.Offset, value.Y.Scale, value.Y.Offset }
	end
	host.setProp(id, key, raw, true)
	local converted = fromRaw(key, raw)
	dispatchSignal('i' .. id .. ':pc:' .. key, { converted })
	dispatchSignal(signalKeyFor(id, 'Changed'), { key })
	-- Humanoid.Health = 0 uruchamia Died (jak w Robloxie)
	if key == 'Health' and rawget(self, '__class') == 'Humanoid' and type(raw) == 'number' and raw <= 0 then
		host.setProp(id, 'Dead', true, true)
		dispatchSignal(signalKeyFor(id, 'sig:Died'), {})
		local modelId = host.getParent(id)
		if modelId then
			host.setProp(modelId, 'Dead', true, true)
			dispatchSignal(signalKeyFor(modelId, 'sig:Died'), {})
		end
		host.humanoidDied(id)
	end
end

InstanceMT.__tostring = function(self) return rawget(self, '__class') or 'Instance' end
InstanceMT.__eq = function(a, b) return rawget(a, '__id') == rawget(b, '__id') end
InstanceMT.__newindex = InstanceMT.__newindex

local Instance = {}
Instance.new = function(className, parent)
	local id = host.newInstance(className, parent and parent.__id or nil)
	return instanceTable(id, className)
end
setmetatable(Instance, {
	__index = function(_, key)
		if key == 'new' then return Instance.new end
		-- np. Instance.ClassName nie istnieje
		return nil
	end,
})

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Eksport do globalnego środowiska skryptów
-- ─────────────────────────────────────────────────────────────────────────────
-- (eksport do środowiska globalnego robi plik exports.lua — tutaj te nazwy
--  są lokalne, więc zapis do nich nie stworzyłby globali)
Vector3, Vector2, CFrame, Color3, UDim, UDim2, BrickColor, Enum, TweenInfo,
	Ray, NumberRange, NumberSequence, ColorSequence, Random, DateTime = Vector3, Vector2, CFrame, Color3, UDim, UDim2,
	BrickColor, Enum, TweenInfo, Ray, NumberRange, NumberSequence, ColorSequence, Random, DateTime
NumberRange, NumberSequence, ColorSequence = NumberRange, NumberSequence, ColorSequence
Vector2int16 = nil
Rect = function(x, y, w, h) return { Min = V2.new(x, y), Max = V2.new(x + w, y + h), Width = w, Height = h } end
Font = { new = function(family, weight, style) return { Family = family, Weight = weight, Style = style } end,
	fromEnum = function(e) return { Family = e } end }
UIScale2 = nil
PhysicalProperties = { new = function(d, f, e) return { Density = d, Friction = f, Elasticity = e } end }
NumberValue = nil

local function bootstrapTick(dt)
	return function()
	end
end

-- Eksportujemy wewnętrzne funkcje potrzebne w drugim pliku (services.lua)
RBX = {
	V3 = V3, v3mt = v3mt, CF = CF, cfmt = cfmt, C3 = C3, c3mt = c3mt,
	UD = UD, udmt = udmt, U2 = U2, u2mt = u2mt, BC = BC,
	enumItem = enumItem, EnumItemMT = EnumItemMT,
	signalFor = signalFor, Signal = Signal, dispatchSignal = dispatchSignal,
	runScriptThread = function(scriptObj, fn)
		local co = coroutine.create(fn)
		resumeThread(co, scriptObj)
	end,
	instanceTable = instanceTable, InstanceMT = InstanceMT, METHODS = METHODS,
	toRaw = toRaw, fromRaw = fromRaw, INST_TABLE = INST_TABLE,
	classSignals = classSignals, signalKeyFor = signalKeyFor, LUA_MEMBERS = LUA_MEMBERS,
	Instance = Instance, Vector3 = Vector3, Vector2 = Vector2, CFrame = CFrame, Color3 = Color3,
	UDim = UDim, UDim2 = UDim2, BrickColor = BrickColor, Enum = Enum, TweenInfo = TweenInfo,
	Ray = Ray, NumberRange = NumberRange, NumberSequence = NumberSequence,
	ColorSequence = ColorSequence, Random = Random, DateTime = DateTime, task = task,
	now = function() return RNOW end, setNow = function(t) RNOW = t end,
	resumeThread = resumeThread,
	TIMERS = TIMERS, defers = defers,
}
