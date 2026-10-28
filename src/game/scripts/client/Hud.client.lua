--!strict
--[[
	Hud.client.lua — LocalScript: buduje interfejs gracza.

	Tworzy ScreenGui z licznikiem punktów i listą powiadomień, słucha
	RemoteEventu „Notify" i odświeża wynik. To pokazuje, że GUI Robloxa
	(ScreenGui → Frame → TextLabel) działa tutaj jak w prawdziwym silniku.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local notify = ReplicatedStorage:WaitForChild("Notify")
local playerGui = player:WaitForChild("PlayerGui")

local screen = Instance.new("ScreenGui")
screen.Name = "GraHud"
screen.IgnoreGuiInset = true
screen.Parent = playerGui

-- panel wyniku (prawy górny róg)
local scoreFrame = Instance.new("Frame")
scoreFrame.Name = "Wynik"
scoreFrame.Size = UDim2.new(0, 190, 0, 74)
scoreFrame.Position = UDim2.new(1, -210, 0, 14)
scoreFrame.BackgroundColor3 = Color3.fromRGB(22, 26, 34)
scoreFrame.BackgroundTransparency = 0.15
scoreFrame.Parent = screen

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, 0, 0, 24)
title.BackgroundTransparency = 1
title.Text = "🏆 TWÓJ WYNIK"
title.TextColor3 = Color3.fromRGB(255, 214, 84)
title.TextSize = 15
title.Font = Enum.Font.GothamBold
title.Parent = scoreFrame

local scoreLabel = Instance.new("TextLabel")
scoreLabel.Name = "Punkty"
scoreLabel.Size = UDim2.new(1, 0, 0, 30)
scoreLabel.Position = UDim2.new(0, 0, 0, 26)
scoreLabel.BackgroundTransparency = 1
scoreLabel.Text = "0 pkt"
scoreLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
scoreLabel.TextSize = 22
scoreLabel.Font = Enum.Font.GothamBold
scoreLabel.Parent = scoreFrame

-- toast (środek ekranu, na chwilę)
local toast = Instance.new("TextLabel")
toast.Name = "Toast"
toast.Size = UDim2.new(0, 420, 0, 46)
toast.Position = UDim2.new(0.5, -210, 0.22, 0)
toast.BackgroundColor3 = Color3.fromRGB(20, 22, 30)
toast.BackgroundTransparency = 0.25
toast.TextColor3 = Color3.fromRGB(255, 255, 255)
toast.TextSize = 20
toast.Font = Enum.Font.GothamBold
toast.Text = ""
toast.Visible = false
toast.Parent = screen

local function refresh()
	local stats = player:FindFirstChild("leaderstats")
	local points = stats and stats:FindFirstChild("Punkty")
	local wins = stats and stats:FindFirstChild("Wygrane")
	local deaths = stats and stats:FindFirstChild("Smierci")
	scoreLabel.Text = (points and tostring(points.Value) or "0") .. " pkt"
	if wins then
		scoreLabel.Text ..= "  •  " .. tostring(wins.Value) .. " wygranych"
	end
	if deaths then
		title.Text = "🏆 TWÓJ WYNIK  •  ☠ " .. tostring(deaths.Value)
	end
end

refresh()

-- odświeżanie wyniku kilka razy na sekundę (leaderstats tworzy serwer,
-- więc nie możemy podłączyć się do nich w momencie startu skryptu)
task.spawn(function()
	local RunService = game:GetService("RunService")
	local accumulated = 0
	RunService.Heartbeat:Connect(function(dt)
		accumulated += dt
		if accumulated >= 0.25 then
			accumulated = 0
			refresh()
		end
	end)
end)

notify.OnClientEvent:Connect(function(message: string, kind: string)
	toast.Text = message
	toast.Visible = true
	if kind == "death" then
		toast.TextColor3 = Color3.fromRGB(255, 120, 120)
	elseif kind == "win" then
		toast.TextColor3 = Color3.fromRGB(120, 255, 150)
	else
		toast.TextColor3 = Color3.fromRGB(255, 220, 120)
	end
	task.delay(2.2, function()
		toast.Visible = false
	end)
	refresh()
end)

print("HudClient gotowy dla", player.Name)
