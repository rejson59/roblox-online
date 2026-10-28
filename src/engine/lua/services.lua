--!nolint
--[[
  services.lua — drzewo gry (`game`) i serwisy silnika: Workspace, Players,
  RunService, TweenService, ReplicatedStorage... oraz pętla ticku, która
  uruchamia eventy, timery i Heartbeat. To odpowiednik "DataModel" z Robloxa.
]]

local R = RBX
local V3, CF, C3 = R.V3, R.CF, R.C3
local now = R.now
local host = host

-- ─────────────────────────────────────────────────────────────────────────────
-- Drzewo gry
-- ─────────────────────────────────────────────────────────────────────────────
local SERVICE_IDS = {
	Workspace = __WS_ID, Players = __PLAYERS_ID, Lighting = __LIGHTING_ID,
	RunService = __RS_ID, ReplicatedStorage = __REPLICATED_ID,
	ServerScriptService = __SERVERSCRIPTS_ID, ServerStorage = __SERVERSTORAGE_ID,
	StarterGui = __STARTERGUI_ID, StarterPlayer = __STARTERPLAYER_ID,
	SoundService = __SOUNDSERVICE_ID, TweenService = __TWEENSERVICE_ID,
	Debris = __DEBRIS_ID, ContentProvider = __CONTENTPROVIDER_ID,
	ReplicatedFirst = __REPLICATEDFIRST_ID, Chat = __CHAT_ID,
}

game = R.instanceTable(__ROOT_ID, 'DataModel')
game.__class = 'DataModel'
workspace = R.instanceTable(__WS_ID, 'Workspace')
Workspace = workspace

local serviceObjects = {}
for name, id in pairs(SERVICE_IDS) do
	if id then serviceObjects[name] = R.instanceTable(id, name) end
end

local GetService = function(_, name)
	if serviceObjects[name] then return serviceObjects[name] end
	-- nieznany serwis: tworzymy atrapę, żeby skrypty nie wywalały się
	warn('game:GetService("' .. tostring(name) .. '") nie jest zaimplementowany — tworzę atrapę')
	local id = host.newInstance(name, __ROOT_ID)
	serviceObjects[name] = R.instanceTable(id, name)
	return serviceObjects[name]
end
game.GetService = GetService
game.FindService = GetService
game.PlaceId = __PLACE_ID or 0
game.JobId = 'local-preview'
game.GameId = 0
game.CreatorId = 0
game.CreatorType = 'User'

-- Globals dla skryptów
local PlayersService = serviceObjects.Players
local RunService = serviceObjects.RunService
local TweenService = serviceObjects.TweenService
local Lighting = serviceObjects.Lighting
local Debris = serviceObjects.Debris

-- ─────────────────────────────────────────────────────────────────────────────
-- RunService
-- ─────────────────────────────────────────────────────────────────────────────
RunService.IsServer = function() return __RUNNING_AS == 'Server' end
RunService.IsClient = function() return __RUNNING_AS == 'Client' end
RunService.IsStudio = function() return false end
RunService.IsRunning = function() return true end
RunService.IsEdit = function() return false end
RunService.BindToRenderStep = function(_, name, priority, fn)
	R.boundRenderSteps = R.boundRenderSteps or {}
	table.insert(R.boundRenderSteps, { name = name, prio = priority, fn = fn })
end
RunService.UnbindFromRenderStep = function(_, name)
	if R.boundRenderSteps then
		for i = #R.boundRenderSteps, 1, -1 do if R.boundRenderSteps[i].name == name then table.remove(R.boundRenderSteps, i) end end
	end
end
RunService.SetRenderStep = RunService.BindToRenderStep
local function signalNamed(id, name)
	local key = R.signalKeyFor(id, name)
	local s = R.signalFor(key)
	if not s._signal then s._signal = R.Signal.new(key, name) end
	return s._signal
end
local HeartbeatSignal = signalNamed(__RS_ID, 'Heartbeat')
local RenderSteppedSignal = signalNamed(__RS_ID, 'RenderStepped')
local SteppedSignal = signalNamed(__RS_ID, 'Stepped')

-- ─────────────────────────────────────────────────────────────────────────────
-- TweenService
-- ─────────────────────────────────────────────────────────────────────────────
local EASING = {
	Linear = function(t) return t end,
	Sine = function(t) return 1 - math.cos(t * math.pi / 2) end,
	Quad = function(t) return t * t end,
	Cubic = function(t) return t * t * t end,
	Quart = function(t) return t ^ 4 end,
	Quint = function(t) return t ^ 5 end,
	Circular = function(t) return 1 - math.sqrt(1 - t * t) end,
	Exponential = function(t) return t == 0 and 0 or 2 ^ (10 * (t - 1)) end,
	Back = function(t) local c = 1.70158; return t * t * ((c + 1) * t - c) end,
	Elastic = function(t)
		if t == 0 or t == 1 then return t end
		return (-2 ^ (10 * (t - 1))) * math.sin((t - 1.075) * (2 * math.pi) / 0.3) + 1
	end,
	Bounce = function(t)
		local n, d = 7.5625, 2.75
		if t < 1 / d then return n * t * t
		elseif t < 2 / d then t = t - 1.5 / d; return n * t * t + 0.75
		elseif t < 2.5 / d then t = t - 2.25 / d; return n * t * t + 0.9375
		else t = t - 2.625 / d; return n * t * t + 0.984375 end
	end,
}
local function applyEasing(styleName, dirName, t)
	local fn = EASING[styleName] or EASING.Linear
	if dirName == 'Out' then t = 1 - fn(1 - t)
	elseif dirName == 'InOut' then
		if t < 0.5 then t = fn(t * 2) / 2 else t = 1 - fn((1 - t) * 2) / 2 end
	else t = fn(t) end
	return t
end

-- interpolacja wartości DataType (uwaga: nigdy nie używamy `#` na tabelach z JS)
local function lerpRaw(a, b, t)
	if type(a) == 'number' and type(b) == 'number' then return a + (b - a) * t end
	local ma, mb = getmetatable(a), getmetatable(b)
	if ma == R.v3mt and mb == R.v3mt then
		return V3.new(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t)
	end
	if ma == R.c3mt and mb == R.c3mt then return a:Lerp(b, t) end
	if ma == R.cfmt and mb == R.cfmt then
		local out = {}
		for i = 1, 12 do out[i] = a[i] + (b[i] - a[i]) * t end
		return setmetatable(out, R.cfmt)
	end
	if ma == R.u2mt and mb == R.u2mt then
		return U2.new(a.X.Scale + (b.X.Scale - a.X.Scale) * t, a.X.Offset + (b.X.Offset - a.X.Offset) * t,
			a.Y.Scale + (b.Y.Scale - a.Y.Scale) * t, a.Y.Offset + (b.Y.Offset - a.Y.Offset) * t)
	end
	if t >= 1 then return b end
	return a
end

local TWEEN_COUNT = 0
local ACTIVE_TWEENS = {}

local function startTween(_, instance, info, goals)
	TWEEN_COUNT += 1
	local tween = { Name = 'Tween' .. TWEEN_COUNT, _instance = instance, _goals = goals,
		_info = info, _start = now() + (info.DelayTime or 0), _finished = false, _paused = false }
	local sig = R.signalFor('i0:tween:' .. TWEEN_COUNT)
	tween.Completed = sig._signal or R.Signal.new('i0:tween:' .. TWEEN_COUNT, 'Completed')
	sig._signal = tween.Completed
	tween.Play = function(self) self._paused = false; ACTIVE_TWEENS[self] = true end
	tween.Pause = function(self) self._paused = true end
	tween.Cancel = function(self)
		ACTIVE_TWEENS[self] = nil
		self._finished = true
		self.Completed:Fire('Canceled')
	end
	ACTIVE_TWEENS[tween] = true
	return tween
end

local function stepTweens()
	for tween in pairs(ACTIVE_TWEENS) do
		if not tween._paused then
			local elapsed = now() - tween._start
			local dur = math.max(tween._info.Time or 1, 0.0001)
			local rawT = elapsed / dur
			if rawT < 0 then
				-- jeszcze przed startem (DelayTime)
			else
				local t = math.min(rawT, 1)
				local eased = applyEasing(tween._info.EasingStyle and tween._info.EasingStyle.Name or 'Linear',
					tween._info.EasingDirection and tween._info.EasingDirection.Name or 'Out', t)
				for key, goal in pairs(tween._goals) do
					local from = tween._from[key]
					local value = lerpRaw(from, goal, eased)
					host.setProp(tween._instance.__id, key, R.toRaw(key, value), true)
					R.dispatchSignal('i' .. tween._instance.__id .. ':pc:' .. key, { R.fromRaw(key, value) })
					R.dispatchSignal(R.signalKeyFor(tween._instance.__id, 'Changed'), { key })
				end
				if t >= 1 then
					ACTIVE_TWEENS[tween] = nil
					tween._finished = true
					tween.Completed:Fire('Completed')
				end
			end
		end
	end
end

TweenService.Create = function(_, instance, info, goals)
	local tween = startTween(nil, instance, info, goals)
	tween._from = {}
	for key in pairs(goals) do
		local raw = host.getProp(instance.__id, key)
		tween._from[key] = R.fromRaw(key, raw)
	end
	return tween
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Debris
-- ─────────────────────────────────────────────────────────────────────────────
Debris.AddItem = function(_, item, lifetime)
	task.delay(lifetime or 10, function()
		if item and item.Parent then item:Destroy() end
	end)
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Players
-- ─────────────────────────────────────────────────────────────────────────────
local localPlayer = __LOCAL_PLAYER_ID and R.instanceTable(__LOCAL_PLAYER_ID, 'Player') or nil
PlayersService.LocalPlayer = localPlayer
PlayersService.GetPlayers = function(_)
	local out = {}
	for _, id in ipairs(RBX_JSON.decode(host.getChildren(__PLAYERS_ID)) or {}) do
		local inst = R.instanceTable(id, 'Player')
		if host.getProp(id, 'ClassName') == 'Player' or host.getProp(id, 'IsPlayer') == true then out[#out + 1] = inst end
	end
	return out
end
PlayersService.GetPlayerFromCharacter = function(_, character)
	for _, player in ipairs(PlayersService:GetPlayers()) do
		if player.Character == character then return player end
	end
	return nil
end
PlayersService.GetPlayerByUserId = function(_, userId)
	for _, p in ipairs(PlayersService:GetPlayers()) do if p.UserId == userId then return p end end
	return nil
end
PlayersService.GetUserIdFromNameAsync = function(_, name) return 0 end
PlayersService.GetNameFromUserIdAsync = function(_, id) return 'Player' .. id end
PlayersService.Chat = function(_, message)
	host.chat(message)
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Workspace: raycast i zapytania przestrzenne
-- ─────────────────────────────────────────────────────────────────────────────
local function makeRaycastResult(raw)
	if not raw then return nil end
	local id = raw[1]
	local inst = R.instanceTable(id, host.getClassName(id))
	local result = {
		Instance = inst,
		Position = V3.new(raw[2], raw[3], raw[4]),
		Normal = V3.new(raw[5], raw[6], raw[7]),
		Distance = raw[8],
		Material = R.enumItem('Material', 256),
	}
	return result
end

workspace.Raycast = function(_, origin, direction, params)
	local ignore = {}
	if params then
		local filter = params.FilterDescendantsInstances or params.filterDescendantsInstances
		if filter then
			for _, inst in ipairs(filter) do
				ignore[#ignore + 1] = inst.__id
				for _, d in ipairs(inst:GetDescendants()) do ignore[#ignore + 1] = d.__id end
			end
		end
	end
	local raw = RBX_JSON.decode(host.raycast(origin.X, origin.Y, origin.Z, direction.X, direction.Y, direction.Z, RBX_JSON.encode(ignore)) or '')
	return makeRaycastResult(raw)
end

workspace.FindPartOnRay = function(_, ray, ignoreDescendantsInstance, ignoreWater, collisionGroup)
	local ignore = {}
	if ignoreDescendantsInstance then
		ignore[#ignore + 1] = ignoreDescendantsInstance.__id
		for _, d in ipairs(ignoreDescendantsInstance:GetDescendants()) do ignore[#ignore + 1] = d.__id end
	end
	local o, d = ray.Origin, ray.Direction
	local raw = RBX_JSON.decode(host.raycast(o.X, o.Y, o.Z, d.X, d.Y, d.Z, RBX_JSON.encode(ignore)) or '')
	if not raw then return nil end
	local hit = V3.new(raw[2], raw[3], raw[4])
	return R.instanceTable(raw[1], host.getClassName(raw[1])), hit, V3.new(raw[5], raw[6], raw[7]), raw[8]
end
workspace.FindPartOnRayWithIgnoreList = function(self, ray, list, ...) 
	local first = list and list[1]
	return workspace:FindPartOnRay(ray, first, ...)
end
workspace.FindPartOnRayWithWhitelist = function(self, ray, list)
	local rawh = RBX_JSON.decode(host.raycast(ray.Origin.X, ray.Origin.Y, ray.Origin.Z, ray.Direction.X, ray.Direction.Y, ray.Direction.Z, '[]') or '')
	if not rawh then return nil end
	return R.instanceTable(rawh[1], host.getClassName(rawh[1])), V3.new(rawh[2], rawh[3], rawh[4]), V3.new(rawh[5], rawh[6], rawh[7]), rawh[8]
end
workspace.GetPartBoundsInBox = function(_, cf, size, params)
	local raw = RBX_JSON.decode(host.aabbQuery(cf[1], cf[2], cf[3], size.X, size.Y, size.Z) or '[]') or {}
	local out = {}
	for _, id in ipairs(raw) do out[#out + 1] = R.instanceTable(id, host.getClassName(id)) end
	return out
end
workspace.GetPartsInPart = function(self, part, params) return workspace:GetPartBoundsInBox(part.CFrame, part.Size) end
workspace.GetPartBoundsInRadius = function(_, pos, radius)
	local raw = RBX_JSON.decode(host.aabbQuery(pos.X, pos.Y, pos.Z, radius * 2, radius * 2, radius * 2) or '[]') or {}
	local out = {}
	for _, id in ipairs(raw) do out[#out + 1] = R.instanceTable(id, host.getClassName(id)) end
	return out
end
workspace.GetBoundingBox = function() end
workspace.Gravity = 196.2
workspace.StreamingEnabled = false

-- ─────────────────────────────────────────────────────────────────────────────
-- Humanoid: zdrowie, MoveTo, animacje (uproszczone)
-- ─────────────────────────────────────────────────────────────────────────────
local function humanoidDied(humanoid)
	local model = humanoid.Parent
	if model then
		for _, obj in ipairs(model:GetChildren()) do
			if obj:IsA('BasePart') then obj.Anchored = false end
		end
		R.dispatchSignal(R.signalKeyFor(model.__id, 'sig:Died'), {})
	end
end

RBX.takeDamage = function(humanoidId, amount)
	local id = humanoidId
	local hp = (host.getProp(id, 'Health') or 100) - amount
	host.setProp(id, 'Health', math.max(hp, 0), true)
	R.dispatchSignal('i' .. id .. ':pc:Health', { math.max(hp, 0) })
	R.dispatchSignal('i' .. id .. ':sig:HealthChanged', { math.max(hp, 0) })
	if hp <= 0 then
		host.setProp(id, 'Dead', true, true)
		R.dispatchSignal('i' .. id .. ':sig:Died', {})
		local modelId = host.getParent(id)
		if modelId then
			host.setProp(modelId, 'Dead', true, true)
			R.dispatchSignal('i' .. modelId .. ':sig:Died', {})
		end
		host.humanoidDied(id)
	end
	return math.max(hp, 0)
end

local HUMANOID_METHODS = {}
HUMANOID_METHODS.TakeDamage = function(self, amount) return RBX.takeDamage(self.__id, amount) end
HUMANOID_METHODS.MoveTo = function(self, position)
	host.setProp(self.__id, 'MoveToPosition', { position.X, position.Y, position.Z }, true)
	host.setProp(self.__id, 'MoveToActive', true, true)
end
HUMANOID_METHODS.ChangeState = function(self, state) host.setProp(self.__id, 'State', state.Value, true) end
HUMANOID_METHODS.GetState = function(self) return R.enumItem('HumanoidStateType', host.getProp(self.__id, 'State') or 5) end
HUMANOID_METHODS.GetStateEnabled = function() return true end
HUMANOID_METHODS.SetStateEnabled = function() end
HUMANOID_METHODS.LoadAnimation = function(self, anim)
	return { Play = function() end, Stop = function() end, AdjustSpeed = function() end, KeyframeReached = { Connect = function() end } }
end
HUMANOID_METHODS.GetPlayingAnimationTracks = function() return {} end
HUMANOID_METHODS.EquipTool = function() end
HUMANOID_METHODS.UnequipTools = function() end
HUMANOID_METHODS.GetMoveVelocity = function() return V3.new(0, 0, 0) end
for name, fn in pairs(HUMANOID_METHODS) do R.METHODS[name] = fn end

-- ─────────────────────────────────────────────────────────────────────────────
-- RemoteEvent / BindableEvent — komunikacja klient ↔ serwer
-- ─────────────────────────────────────────────────────────────────────────────
local REMOTES = {}
R.METHODS.FireServer = function(self, ...)
	local args = {}
	for i = 1, select('#', ...) do args[i] = R.toRaw('arg' .. i, (select(i, ...))) end
	host.remoteFire(self.__id, 'server', 0, args)
end
R.METHODS.FireClient = function(self, player, ...)
	local args = {}
	for i = 1, select('#', ...) do args[i] = R.toRaw('arg' .. i, (select(i, ...))) end
	host.remoteFire(self.__id, 'client', player and player.__id or 0, args)
end
R.METHODS.FireAllClients = function(self, ...)
	local args = {}
	for i = 1, select('#', ...) do args[i] = R.toRaw('arg' .. i, (select(i, ...))) end
	host.remoteFire(self.__id, 'all', 0, args)
end
R.METHODS.InvokeServer = function(self, ...)
	local args = {}
	for i = 1, select('#', ...) do args[i] = R.toRaw('arg' .. i, (select(i, ...))) end
	return host.remoteInvoke(self.__id, 'server', 0, args)
end
R.METHODS.Fire = function(self, ...)
	local args = {}
	for i = 1, select('#', ...) do args[i] = R.toRaw('arg' .. i, (select(i, ...))) end
	host.bindableFire(self.__id, args)
end
R.METHODS.Invoke = function(self, ...)
	return host.bindableInvoke(self.__id, { ... })
end

-- ─────────────────────────────────────────────────────────────────────────────
-- GUI: minimalny most do DOM (ScreenGui/Frame/TextLabel/TextButton)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- require() dla ModuleScript
--
-- Moduły są kompilowane przez JS na starcie jako definicje funkcji w tabeli
-- `RBX.moduleDefs` (klucz = id instancji). Dzięki temu wszystko zostaje po
-- stronie Luau — nie trzeba przenosić funkcji Lua przez mostek.
-- ─────────────────────────────────────────────────────────────────────────────
R.moduleDefs = {}
local moduleCache = {}
local function requireModule(target)
	if type(target) ~= 'table' or not rawget(target, '__id') then
		error('require: oczekiwano ModuleScript (otrzymano ' .. type(target) .. ')')
	end
	local id = rawget(target, '__id')
	local cached = moduleCache[id]
	if cached ~= nil then return cached end
	local def = R.moduleDefs[id]
	if not def then
		error('require: ModuleScript ' .. tostring(host.fullName(id)) .. ' nie został wczytany')
	end
	local result = def(target)
	if result == nil then result = true end
	moduleCache[id] = result
	return result
end
require = requireModule

-- ─────────────────────────────────────────────────────────────────────────────
-- Pętla główna (wywoływana z JS raz na klatkę)
-- ─────────────────────────────────────────────────────────────────────────────
local lastStep = 0

local function processEvents()
	while true do
		local raw = host.pollEvent()
		if not raw then break end
		local ev = RBX_JSON.decode(raw)
		if ev then
			local key = ev.key
			local args = ev.args or {}
			local function toId(v)
				if type(v) == 'string' and v:sub(1, 1) == '@' then return tonumber(v:sub(2)) end
				return v
			end
			if key == '__chat' then
				local playerId, message = toId(args[1]), args[2]
				if not playerId or playerId == 0 then
					R.dispatchSignal('chat:system', { message })
				else
					local player = R.instanceTable(playerId, 'Player')
					host.log('info', tostring(host.getProp(playerId, 'Name')) .. ': ' .. tostring(message))
					R.dispatchSignal(R.signalKeyFor(playerId, 'sig:Chatted'), { message, player })
				end
			elseif key == '__playerAdded' then
				R.dispatchSignal(R.signalKeyFor(__PLAYERS_ID, 'PlayerAdded'), { R.instanceTable(toId(args[1]), 'Player') })
			elseif key == '__playerRemoving' then
				R.dispatchSignal(R.signalKeyFor(__PLAYERS_ID, 'PlayerRemoving'), { R.instanceTable(toId(args[1]), 'Player') })
			elseif key == '__remote' then
				local remoteId, dir, playerId, payload = args[1], args[2], args[3], args[4]
				local unpacked = {}
				if type(payload) == 'table' then
					for i = 1, #payload do unpacked[i] = R.fromRaw('arg' .. i, payload[i]) end
				end
				if dir == 'server' then
					local player = R.fromRaw('argPlayer', playerId)
					R.dispatchSignal('i' .. remoteId .. ':sig:OnServerEvent', { player, table.unpack(unpacked) })
				elseif dir == 'client' then
					R.dispatchSignal('i' .. remoteId .. ':sig:OnClientEvent', { table.unpack(unpacked) })
				end
			else
				local unpacked = {}
				for i = 1, #args do unpacked[i] = R.fromRaw('arg' .. i, args[i]) end
				R.dispatchSignal(key, unpacked)
			end
		end
	end
end

local function processTimers(dt)
	local t = now()
	for i = #R.TIMERS, 1, -1 do
		local timer = R.TIMERS[i]
		if timer.at <= t then
			table.remove(R.TIMERS, i)
			R.resumeThread(timer.co, table.unpack(timer.args or {}))
		end
	end
end

function RBX.tick(dt, nowSec)
	R.setNow(nowSec)
	processEvents()
	processTimers(dt)
	stepTweens()
	R.dispatchSignal(R.signalKeyFor(__RS_ID, 'Stepped'), { nowSec, dt })
	R.dispatchSignal(R.signalKeyFor(__RS_ID, 'Heartbeat'), { dt })
	if __RUNNING_AS == 'Client' then
		R.dispatchSignal(R.signalKeyFor(__RS_ID, 'RenderStepped'), { dt })
		if R.boundRenderSteps then
			for _, step in ipairs(R.boundRenderSteps) do
				local co = coroutine.create(step.fn)
				R.resumeThread(co, dt)
			end
		end
	end
	local d = R.defers
	R.defers = {}
	for _, item in ipairs(d) do
		local co = coroutine.create(item.fn)
		R.resumeThread(co, table.unpack(item.args))
	end
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Narzędzia dodatkowe zgodne z Robloxem
-- ─────────────────────────────────────────────────────────────────────────────
local UserInputService = {
	InputBegan = R.signalFor('uis:InputBegan')._signal or R.Signal.new('uis:InputBegan', 'InputBegan'),
	InputEnded = R.signalFor('uis:InputEnded')._signal or R.Signal.new('uis:InputEnded', 'InputEnded'),
	GetFocusedTextBox = function() return nil end,
	IsKeyDown = function(_, key) return host.isKeyDown(key.Value or key.Name or '') end,
	GetMouseLocation = function() return Vector2.new(host.mouseX(), host.mouseY()) end,
	MouseBehavior = 'Default',
	TouchEnabled = false,
	KeyboardEnabled = true,
	GamepadEnabled = false,
}
R.signalFor('uis:InputBegan')._signal = UserInputService.InputBegan
R.signalFor('uis:InputEnded')._signal = UserInputService.InputEnded
serviceObjects.UserInputService = UserInputService
R.UserInputService = UserInputService
game:GetService('UserInputService')
GetService = GetService
UserInputService = UserInputService

local TweenServiceObj = TweenService
ContextActionService = {
	BindAction = function() end, UnbindAction = function() end, BindActionAtPriority = function() end,
}
StarterGui = serviceObjects.StarterGui
SetCore = function() end

-- Wywoływane przez JS przy uruchamianiu skryptów w kontenerach
RBX.PlayersService = PlayersService
RBX.ReplicatedStorage = serviceObjects.ReplicatedStorage
RBX.ServerScriptService = serviceObjects.ServerScriptService
RBX.ServerStorage = serviceObjects.ServerStorage
RBX.StarterGui = serviceObjects.StarterGui
RBX.StarterPlayer = serviceObjects.StarterPlayer
RBX.Lighting = serviceObjects.Lighting
RBX.Debris = serviceObjects.Debris
RBX.SoundService = serviceObjects.SoundService
RBX.CurrentCamera = serviceObjects.Workspace and workspace:FindFirstChild('Camera')

RBX.RunService = RunService
RBX.TweenService = TweenService
