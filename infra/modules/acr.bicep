param location string
param name string
param tags object
param backendPrincipalId string

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// AcrPull for the managed identity used by Container Apps
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource backendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, backendPrincipalId, 'acr-pull')
  scope: registry
  properties: {
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

output loginServer string = registry.properties.loginServer
output name string = registry.name
output id string = registry.id
