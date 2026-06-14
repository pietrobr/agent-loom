// Azure AI Foundry account (AIServices) + project + one model deployment.
param location string
param accountName string
param projectName string
param modelName string
param modelVersion string
param embeddingModelName string = 'text-embedding-3-small'
param embeddingModelVersion string = '1'
param tags object
param backendPrincipalId string
param deployerPrincipalId string

resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: accountName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    allowProjectManagement: true
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: account
  name: projectName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {}
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: account
  name: modelName
  sku: { name: 'GlobalStandard', capacity: 30 }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

// Embedding deployment for the RAG pipeline (vector search). Created after the
// chat model: Cognitive Services does not allow parallel deployment creation.
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: account
  name: embeddingModelName
  dependsOn: [ modelDeployment ]
  sku: { name: 'GlobalStandard', capacity: 120 }
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModelName
      version: embeddingModelVersion
    }
  }
}

// Azure AI User — data-plane role for Foundry projects (covers agents/threads/runs).
var aiUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

resource backendFoundryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, backendPrincipalId, 'aifoundry-user')
  scope: account
  properties: {
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', aiUserRoleId)
  }
}

resource deployerFoundryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(account.id, deployerPrincipalId, 'aifoundry-user-deployer')
  scope: account
  properties: {
    principalId: deployerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', aiUserRoleId)
  }
}

output accountName string = account.name
output projectName string = project.name
output embeddingDeployment string = embeddingDeployment.name
// Foundry data-plane endpoint, e.g. https://<account>.services.ai.azure.com/api/projects/<project>
output projectEndpoint string = 'https://${account.name}.services.ai.azure.com/api/projects/${project.name}'
// Azure AI Foundry portal deep link base for this project (wsid only; the tenant
// id is passed separately to avoid '&' in env vars).
output portalUrl string = 'https://ai.azure.com/build/agents?wsid=${project.id}'
output tenantId string = tenant().tenantId
