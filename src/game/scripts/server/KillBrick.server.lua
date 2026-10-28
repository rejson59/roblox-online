--!strict
--[[
	KillBrick.server.lua — czerwona płyta, która zabija.

	Pokazuje dwa elementy Robloxa: `Touched` oraz `Humanoid.Health = 0`,
	które uruchamia `Humanoid.Died` i respawn po 3 sekundach.
]]

local part = script.Parent
local BRIGHT = Color3.fromRGB(255, 72, 72)
local FLASH = Color3.fromRGB(255, 255, 255)

part.Touched:Connect(function(hit)
	local character = hit.Parent
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid or humanoid.Health <= 0 then
		return
	end
	humanoid.Health = 0
	part.Color = FLASH
	task.wait(0.12)
	part.Color = BRIGHT
end)
