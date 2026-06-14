param location string
param name string
param tags object
param backendPrincipalId string
param deployerPrincipalId string = ''

resource search 'Microsoft.Search/searchServices@2024-03-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'basic' }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    disableLocalAuth: true
    publicNetworkAccess: 'enabled'
    // Enable the semantic ranker (free plan: 1000 queries/month, then the app
    // falls back to keyword+vector). Required for query_type='semantic'.
    semanticSearch: 'free'
  }
}

// Search Index Data Contributor — read/write documents
var indexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
// Search Service Contributor — manage indexes/indexers
var serviceContributorRoleId = '7ca78c08-252a-4471-8644-bb5ff32d4ba0'

resource indexDataRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, backendPrincipalId, 'search-index-data')
  scope: search
  properties: {
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', indexDataContributorRoleId)
  }
}

resource serviceContribRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, backendPrincipalId, 'search-service-contrib')
  scope: search
  properties: {
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceContributorRoleId)
  }
}

resource deployerIndexDataRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(search.id, deployerPrincipalId, 'search-index-data-deployer')
  scope: search
  properties: {
    principalId: deployerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', indexDataContributorRoleId)
  }
}

resource deployerServiceContribRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(search.id, deployerPrincipalId, 'search-service-contrib-deployer')
  scope: search
  properties: {
    principalId: deployerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceContributorRoleId)
  }
}

output endpoint string = 'https://${search.name}.search.windows.net'
output name string = search.name
output id string = search.id
