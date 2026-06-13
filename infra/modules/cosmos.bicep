param location string
param name string
param tags object
param backendPrincipalId string
param deployerPrincipalId string = ''

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      { locationName: location, failoverPriority: 0, isZoneRedundant: false }
    ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    capabilities: [
      { name: 'EnableServerless' }
    ]
    disableLocalAuth: true
    publicNetworkAccess: 'Disabled'
  }
}

resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: account
  name: 'agentloom'
  properties: {
    resource: { id: 'agentloom' }
  }
}

var containers = [
  { name: 'catalog',   pk: '/org_id' }
  { name: 'tenants',   pk: '/org_id' }
  { name: 'instances', pk: '/org_id' }
  { name: 'metering',  pk: '/org_id' }
  { name: 'threads',   pk: '/org_id' }
]

resource cosmosContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for c in containers: {
  parent: db
  name: c.name
  properties: {
    resource: {
      id: c.name
      partitionKey: { paths: [ c.pk ], kind: 'Hash' }
    }
  }
}]

// Built-in Cosmos DB Data Contributor (data plane role)
resource dataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions@2024-05-15' existing = {
  parent: account
  name: '00000000-0000-0000-0000-000000000002'
}

resource backendDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: account
  name: guid(account.id, backendPrincipalId, 'cosmos-data-contrib')
  properties: {
    roleDefinitionId: dataContributor.id
    principalId: backendPrincipalId
    scope: account.id
  }
}

resource deployerDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = if (!empty(deployerPrincipalId)) {
  parent: account
  name: guid(account.id, deployerPrincipalId, 'cosmos-data-contrib-deployer')
  properties: {
    roleDefinitionId: dataContributor.id
    principalId: deployerPrincipalId
    scope: account.id
  }
}

output endpoint string = account.properties.documentEndpoint
output name string = account.name
output id string = account.id
