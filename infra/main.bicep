targetScope = 'resourceGroup'

// =============================================================================
// AgentLoom — root Bicep deployment.
// Provisions: Log Analytics + App Insights, Key Vault, Cosmos DB (NoSQL),
// Azure AI Search, private Storage Account, ACR, Container Apps Environment +
// three Container Apps, a user-assigned managed identity, an Azure AI Foundry
// (AIServices) account + project + model deployment, and least-privilege RBAC.
// =============================================================================

@minLength(2)
@maxLength(12)
@description('Configurable resource name prefix (default agentloom).')
param resourcePrefix string = 'agentloom'

@description('Short environment name (azd env), e.g. dev, prod.')
param environmentName string = 'dev'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Object id of the user/principal running azd up (for KV access).')
param principalId string = ''

@description('Foundry model to deploy (Azure OpenAI compatible).')
param foundryModelName string = 'gpt-4o-mini'

@description('Foundry model version.')
param foundryModelVersion string = '2024-07-18'

@description('Container image tag to deploy initially (azd overrides this).')
param containerImageTag string = 'latest'

@description('Whether each service already exists (set by azd via SERVICE_*_RESOURCE_EXISTS).')
param backendExists bool = false
param adminExists bool = false
param customerExists bool = false

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
var suffix = uniqueString(resourceGroup().id, environmentName)
var baseName = toLower('${resourcePrefix}${environmentName}')

var names = {
  logAnalytics: '${baseName}-log-${suffix}'
  appInsights:  '${baseName}-ai-${suffix}'
  keyvault:     take('${baseName}kv${suffix}', 24)
  cosmos:       take('${baseName}cosmos${suffix}', 44)
  search:       take('${baseName}search${suffix}', 60)
  storage:      take('${replace(baseName, '-', '')}st${suffix}', 24)
  acr:          take('${replace(baseName, '-', '')}acr${suffix}', 50)
  managedEnv:   '${baseName}-cae-${suffix}'
  vnet:         '${baseName}-vnet-${suffix}'
  identity:     '${baseName}-id-${suffix}'
  foundry:      take('${baseName}-aif-${suffix}', 60)
  foundryProj:  'project'
  backendApp:   'backend'
  adminApp:     'admin-designer'
  customerApp:  'customer-webapp'
}

var commonTags = {
  'azd-env-name':  environmentName
  product:         'AgentLoom'
  'resource-prefix': resourcePrefix
}

// ---------------------------------------------------------------------------
// Identity (used by all Container Apps)
// ---------------------------------------------------------------------------
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.identity
  location: location
  tags: commonTags
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------
module observability 'modules/observability.bicep' = {
  name: 'observability'
  params: {
    location: location
    logAnalyticsName: names.logAnalytics
    appInsightsName: names.appInsights
    tags: commonTags
  }
}

// ---------------------------------------------------------------------------
// Networking (VNet + private DNS) for private connectivity to Cosmos/Storage
// ---------------------------------------------------------------------------
module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    name: names.vnet
    tags: commonTags
  }
}

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------
module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    name: names.keyvault
    tags: commonTags
    backendPrincipalId: managedIdentity.properties.principalId
    deployerPrincipalId: principalId
  }
}

// ---------------------------------------------------------------------------
// Storage (PRIVATE — no public blob access)
// ---------------------------------------------------------------------------
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    name: names.storage
    tags: commonTags
    backendPrincipalId: managedIdentity.properties.principalId
    deployerPrincipalId: principalId
  }
}

// ---------------------------------------------------------------------------
// Cosmos DB (NoSQL) — catalog/tenants/instances/metering
// ---------------------------------------------------------------------------
module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    name: names.cosmos
    tags: commonTags
    backendPrincipalId: managedIdentity.properties.principalId
    deployerPrincipalId: principalId
  }
}

// ---------------------------------------------------------------------------
// Azure AI Search — per-customer indexes (kb-{org_id})
// ---------------------------------------------------------------------------
module search 'modules/search.bicep' = {
  name: 'search'
  params: {
    location: location
    name: names.search
    tags: commonTags
    backendPrincipalId: managedIdentity.properties.principalId
    deployerPrincipalId: principalId
  }
}

// ---------------------------------------------------------------------------
// Container Registry
// ---------------------------------------------------------------------------
module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    location: location
    name: names.acr
    tags: commonTags
    backendPrincipalId: managedIdentity.properties.principalId
  }
}

// ---------------------------------------------------------------------------
// Azure AI Foundry (AIServices account + project + model deployment)
// ---------------------------------------------------------------------------
module foundry 'modules/foundry.bicep' = {
  name: 'foundry'
  params: {
    location: location
    accountName: names.foundry
    projectName: names.foundryProj
    modelName: foundryModelName
    modelVersion: foundryModelVersion
    tags: commonTags
    backendPrincipalId: managedIdentity.properties.principalId
    deployerPrincipalId: principalId
  }
}

// ---------------------------------------------------------------------------
// Private endpoints (Cosmos + Storage are policy-restricted to no public access)
// ---------------------------------------------------------------------------
module cosmosPe 'modules/privateEndpoint.bicep' = {
  name: 'cosmosPe'
  params: {
    location: location
    name: '${names.cosmos}-pe'
    tags: commonTags
    subnetId: network.outputs.peSubnetId
    serviceId: cosmos.outputs.id
    groupId: 'Sql'
    dnsZoneId: network.outputs.cosmosDnsZoneId
  }
}

module storagePe 'modules/privateEndpoint.bicep' = {
  name: 'storagePe'
  params: {
    location: location
    name: '${names.storage}-pe'
    tags: commonTags
    subnetId: network.outputs.peSubnetId
    serviceId: storage.outputs.id
    groupId: 'blob'
    dnsZoneId: network.outputs.blobDnsZoneId
  }
}

// ---------------------------------------------------------------------------
// Container Apps Environment + three Container Apps
// ---------------------------------------------------------------------------
module containerEnv 'modules/containerenv.bicep' = {
  name: 'containerenv'
  params: {
    location: location
    name: names.managedEnv
    logAnalyticsCustomerId: observability.outputs.logAnalyticsCustomerId
    logAnalyticsSharedKey: observability.outputs.logAnalyticsSharedKey
    infrastructureSubnetId: network.outputs.infraSubnetId
    tags: commonTags
  }
}

module backendApp 'modules/containerapp.bicep' = {
  name: 'backendApp'
  params: {
    location: location
    name: names.backendApp
    environmentId: containerEnv.outputs.environmentId
    identityId: managedIdentity.id
    acrLoginServer: acr.outputs.loginServer
    image: '${acr.outputs.loginServer}/${names.backendApp}:${containerImageTag}'
    targetPort: 8000
    externalIngress: true
    exists: backendExists
    tags: union(commonTags, { 'azd-service-name': 'backend' })
    envVars: [
      { name: 'COSMOS_ENDPOINT', value: cosmos.outputs.endpoint }
      { name: 'COSMOS_DATABASE', value: 'agentloom' }
      { name: 'SEARCH_ENDPOINT', value: search.outputs.endpoint }
      { name: 'STORAGE_ACCOUNT',  value: storage.outputs.accountName }
      { name: 'STORAGE_CONTAINER', value: 'knowledge' }
      { name: 'KEYVAULT_URI',     value: keyvault.outputs.uri }
      { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundry.outputs.projectEndpoint }
      { name: 'FOUNDRY_MODEL_DEPLOYMENT', value: foundryModelName }
      { name: 'AZURE_CLIENT_ID',  value: managedIdentity.properties.clientId }
      { name: 'ALLOWED_ORIGINS',  value: '*' }
      { name: 'ALLOW_DEV_TOKENS', value: 'true' }
    ]
  }
}

module adminApp 'modules/containerapp.bicep' = {
  name: 'adminApp'
  params: {
    location: location
    name: names.adminApp
    environmentId: containerEnv.outputs.environmentId
    identityId: managedIdentity.id
    acrLoginServer: acr.outputs.loginServer
    image: '${acr.outputs.loginServer}/${names.adminApp}:${containerImageTag}'
    targetPort: 80
    externalIngress: true
    exists: adminExists
    tags: union(commonTags, { 'azd-service-name': 'admin-designer' })
    envVars: [
      { name: 'API_BASE', value: 'https://${backendApp.outputs.fqdn}' }
    ]
  }
}

module customerApp 'modules/containerapp.bicep' = {
  name: 'customerApp'
  params: {
    location: location
    name: names.customerApp
    environmentId: containerEnv.outputs.environmentId
    identityId: managedIdentity.id
    acrLoginServer: acr.outputs.loginServer
    image: '${acr.outputs.loginServer}/${names.customerApp}:${containerImageTag}'
    targetPort: 80
    externalIngress: true
    exists: customerExists
    tags: union(commonTags, { 'azd-service-name': 'customer-webapp' })
    envVars: [
      { name: 'API_BASE', value: 'https://${backendApp.outputs.fqdn}' }
    ]
  }
}

// ---------------------------------------------------------------------------
// Outputs (consumed by azd / scripts)
// ---------------------------------------------------------------------------
output AZURE_RESOURCE_GROUP    string = resourceGroup().name
output AZURE_RESOURCE_PREFIX   string = resourcePrefix
output MANAGED_IDENTITY_ID     string = managedIdentity.id
output MANAGED_IDENTITY_CLIENT string = managedIdentity.properties.clientId
output COSMOS_ENDPOINT         string = cosmos.outputs.endpoint
output COSMOS_DATABASE         string = 'agentloom'
output SEARCH_ENDPOINT         string = search.outputs.endpoint
output SEARCH_NAME             string = search.outputs.name
output STORAGE_ACCOUNT         string = storage.outputs.accountName
output STORAGE_CONTAINER       string = 'knowledge'
output KEYVAULT_URI            string = keyvault.outputs.uri
output FOUNDRY_PROJECT_ENDPOINT string = foundry.outputs.projectEndpoint
output FOUNDRY_MODEL_DEPLOYMENT string = foundryModelName
output ACR_LOGIN_SERVER        string = acr.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.outputs.loginServer
output BACKEND_URL             string = 'https://${backendApp.outputs.fqdn}'
output ADMIN_URL               string = 'https://${adminApp.outputs.fqdn}'
output CUSTOMER_URL            string = 'https://${customerApp.outputs.fqdn}'
