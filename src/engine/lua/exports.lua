--!nolint
--[[
  exports.lua — wystawienie API silnika do globalnego środowiska skryptów.

  Musi to być osobny plik/„chunk”: w runtime.lua te nazwy są zmiennymi
  lokalnymi, a w Luau przypisanie do widocznej zmiennej lokalnej nie tworzy
  globala. Tutaj żadna z tych nazw nie jest lokalna, więc `X = ...` trafia
  do środowiska skryptów — dokładnie jak w Robloxie.
]]

Instance = RBX.Instance
Vector3 = RBX.Vector3
Vector2 = RBX.Vector2
CFrame = RBX.CFrame
Color3 = RBX.Color3
UDim = RBX.UDim
UDim2 = RBX.UDim2
BrickColor = RBX.BrickColor
Enum = RBX.Enum
TweenInfo = RBX.TweenInfo
Ray = RBX.Ray
NumberRange = RBX.NumberRange
NumberSequence = RBX.NumberSequence
ColorSequence = RBX.ColorSequence
Random = RBX.Random
DateTime = RBX.DateTime
task = RBX.task
UserInputService = RBX.UserInputService

-- Serwisy jako zmienne globalne (wygodne, choć w Robloxie używa się GetService)
Players = RBX.PlayersService
ReplicatedStorage = RBX.ReplicatedStorage
ServerScriptService = RBX.ServerScriptService
ServerStorage = RBX.ServerStorage
StarterGui = RBX.StarterGui
StarterPlayer = RBX.StarterPlayer
Lighting = RBX.Lighting
Debris = RBX.Debris
SoundService = RBX.SoundService
RunService = RBX.RunService
TweenService = RBX.TweenService
