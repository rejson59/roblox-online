--!strict
--[[
	Coins.server.lua — monety na trasie obby.

	Klasyczny wzorzec Robloxa: `Touched` na części, sprawdzenie Humanoida
	i naliczenie punktów graczowi przez leaderstats. Moneta znika na 4 sekundy
	i wraca. Cały kod to zwykły Luau — działa bez zmian w prawdziwym Robloxie
	(gdyby `notify` nie było, wystarczy je usunąć).
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local coins = script.Parent
local notify = ReplicatedStorage:WaitForChild("Notify")

local RESPAWN_TIME = 4
local POINTS = 10

local function addPoints(player: Player, amount: number)
	local stats = player:FindFirstChild("leaderstats")
	local points = stats and stats:FindFirstChild("Punkty")
	if points then
		points.Value += amount
	end
end

for _, coin in ipairs(coins:GetChildren()) do
	if coin:IsA("BasePart") then
		local taken = false

		coin.Touched:Connect(function(hit)
			if taken then
				return
			end
			local character = hit.Parent
			local humanoid = character and character:FindFirstChild("Humanoid")
			if not humanoid or humanoid.Health <= 0 then
				return
			end
			taken = true
			local player = Players:GetPlayerFromCharacter(character)
			if player then
				addPoints(player, POINTS)
				notify:FireClient(player, "+" .. POINTS .. " punktów!", "coin")
			end
			coin.Transparency = 1
			coin.CanTouch = false
			task.wait(RESPAWN_TIME)
			coin.Transparency = 0
			coin.CanTouch = true
			taken = false
		end)
	end
end

-- obracanie monet (Heartbeat = co klatkę)
RunService.Heartbeat:Connect(function(dt)
	for _, coin in ipairs(coins:GetChildren()) do
		if coin:IsA("BasePart") then
			coin.CFrame = coin.CFrame * CFrame.Angles(0, dt * 2.2, 0)
		end
	end
end)

print("CoinsScript: aktywnych monet:", #coins:GetChildren())
