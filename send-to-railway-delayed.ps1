param(
    [int]$DelaySeconds = 60,
    [string]$Endpoint = "http://giving-enthusiasm-production-8aa8.up.railway.app/api/sensor-data"
)

Write-Host "Waiting $DelaySeconds seconds before sending data to Railway..."
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

Start-Sleep -Seconds $DelaySeconds

Write-Host ""
Write-Host "Sending data to Railway..."
Write-Host "Endpoint: $Endpoint"
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

$json = @{
    location = "Lab Sensor A"
    metrics = @{
        pm1 = 12
        pm25 = 20
        pm10 = 40
        co = 2.5
        co2 = 410
        o3 = 26
        no2 = 14
        temperature = 26.5
        humidity = 67
        voc_index = 135
        nox_index = 59
    }
} | ConvertTo-Json

$response = curl.exe -X POST $Endpoint `
    -H "Content-Type: application/json" `
    -d $json

Write-Host ""
Write-Host "Response:"
Write-Host $response
Write-Host ""
Write-Host "Completed at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
