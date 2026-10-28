--!strict
--[[
	GameService.server.lua — logika serwera: powitanie, punkty za metę,
	zapisywanie checkpointów i licznik śmierci.

	To jest typowy „główny" skrypt gry w Robloxie.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local notify = ReplicatedStorage:WaitForChild("Notify")
local checkpoints = workspace:WaitForChild("Checkpoints")
local finishPad = workspace:WaitForChild("Obby"):WaitForChild("Finish")

local finished = {}

local function leaderstat(player: Player, name: string, default: number)
	local stats = player:FindFirstChild("leaderstats")
	if not stats then
		return nil
	end
	local value = stats:FindFirstChild(name)
	if not value then
		value = Instance.new("IntValue")
		value.Name = name
		value.Value = default
		value.Parent = stats
	end
	return value
end

Players.PlayerAdded:Connect(function(player)
	leaderstat(player, "Punkty", 0)
	leaderstat(player, "Wygrane", 0)
	leaderstat(player, "Smierci", 0)
	print("Gracz dołączył:", player.Name)

	player.CharacterAdded:Connect(function(character)
		local humanoid = character:WaitForChild("Humanoid")
		humanoid.Died:Connect(function()
			local deaths = leaderstat(player, "Smierci", 0)
			if deaths then
				deaths.Value += 1
			end
			notify:FireClient(player, "Aj! Zmartwychwstaniesz za chwilę", "death")
		end)
	end)
end)

-- checkpointy: dotknięcie zapisuje miejsce odrodzenia
for _, cp in ipairs(checkpoints:GetChildren()) do
	if cp:IsA("BasePart") then
		cp.Touched:Connect(function(hit)
			local character = hit.Parent
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			if not humanoid then
				return
			end
			local player = Players:GetPlayerFromCharacter(character)
			if not player then
				return
			end
			local index = cp:GetAttribute("Index") or 0
			local best = player:GetAttribute("CheckpointIndex") or 0
			-- zapisujemy tylko dalszy checkpoint (nie cofamy postępu)
			if index <= best then
				return
			end
			local cf = cp.CFrame + Vector3.new(0, 5, 0)
			player:SetAttribute("CheckpointIndex", index)
			player:SetAttribute("RespawnPoint", { cf.X, cf.Y, cf.Z })
			notify:FireClient(player, "Checkpoint " .. tostring(index) .. " zapisany!", "checkpoint")
		end)
	end
end

-- meta
finishPad.Touched:Connect(function(hit)
	local character = hit.Parent
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return
	end
	local player = Players:GetPlayerFromCharacter(character)
	if not player or finished[player] then
		return
	end
	finished[player] = true
	local wins = leaderstat(player, "Wygrane", 0)
	if wins then
		wins.Value += 1
	end
	notify:FireClient(player, "🏁 META! Świetny bieg!", "win")
	task.wait(6)
	finished[player] = nil
end)

Players.PlayerRemoving:Connect(function(player)
	finished[player] = nil
end)
