param location string
param name string
param logAnalyticsCustomerId string
@secure()
param logAnalyticsSharedKey string
param tags object

@description('Optional infrastructure subnet id for VNet integration. When set, the environment can reach private endpoints. Immutable after creation.')
param infrastructureSubnetId string = ''

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
    vnetConfiguration: empty(infrastructureSubnetId) ? null : {
      infrastructureSubnetId: infrastructureSubnetId
      internal: false
    }
    zoneRedundant: false
  }
}

output environmentId string = env.id
output defaultDomain string = env.properties.defaultDomain
