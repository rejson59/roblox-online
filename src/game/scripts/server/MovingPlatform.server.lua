--!strict
--[[
	MovingPlatform.server.lua — platforma jeżdżąca w górę i w dół.
	Używa TweenService z nieskończonym powtarzaniem (RepeatCount = -1).
]]

local TweenService = game:GetService("TweenService")

local platform = script.Parent
local startCFrame = platform.CFrame
local offset = Vector3.new(0, 9, 0)

local info = TweenInfo.new(2.4, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
local tween = TweenService:Create(platform, info, { CFrame = startCFrame + offset })
tween:Play()
