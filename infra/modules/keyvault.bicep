param location string
param name string
param tags object
param backendPrincipalId string
param deployerPrincipalId string

@description('Optional: name of the CIAM provisioning secret to seed at deploy time.')
param provisioningSecretName string = 'ciam-provisioning-secret'
@description('Optional: value of the CIAM provisioning secret. Empty = do not create/update it (the control-plane write works even when public network access is disabled).')
@secure()
param provisioningSecretValue string = ''

resource kv 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    // No public network access: the vault is reached only via its private
    // endpoint (created in main.bicep) from inside the VNet. Deploy-time secret
    // seeding below is a control-plane (ARM) write, so it still succeeds.
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

// Key Vault Secrets User
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource backendKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, backendPrincipalId, 'kv-secrets-user')
  scope: kv
  properties: {
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

// Key Vault Administrator for deployer (to seed initial secrets)
var kvAdminRoleId = '00482a5a-887f-4fb3-b363-3b7fe8e74483'

resource deployerKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(kv.id, deployerPrincipalId, 'kv-admin')
  scope: kv
  properties: {
    principalId: deployerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvAdminRoleId)
  }
}

// Seed the CIAM provisioning secret at deploy time. This is a control-plane
// write (ARM), so it succeeds even when the vault's public network access is
// disabled by policy — unlike `az keyvault secret set` from a dev machine.
// Skipped when no value is supplied (e.g. dev mode, or re-deploys after the
// secret was cleared from the azd env).
resource provisioningSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = if (!empty(provisioningSecretValue)) {
  parent: kv
  name: provisioningSecretName
  properties: {
    value: provisioningSecretValue
  }
}

output uri string = kv.properties.vaultUri
output name string = kv.name
output id string = kv.id
