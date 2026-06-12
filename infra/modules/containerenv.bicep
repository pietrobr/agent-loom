param location string
param name string
param logAnalyticsCustomerId string
@secure()
param logAnalyticsSharedKey string
param tags object

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
    zoneRedundant: false
  }
}

output environmentId string = env.id
output defaultDomain string = env.properties.defaultDomain
