// =============================================================================
// Networking for private connectivity.
// Creates a VNet with:
//   - an "infra" subnet delegated to the Container Apps environment
//   - a "pe" subnet that hosts private endpoints
// plus the private DNS zones (+ VNet links) needed so the Container Apps
// environment resolves Cosmos and Storage to their private endpoint IPs.
// =============================================================================
param location string
param name string
param tags object

@description('VNet address space.')
param vnetCidr string = '10.20.0.0/16'

@description('Subnet for the Container Apps environment (Consumption needs /23).')
param infraSubnetCidr string = '10.20.0.0/23'

@description('Subnet that holds the private endpoints.')
param peSubnetCidr string = '10.20.2.0/24'

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [ vnetCidr ] }
    subnets: [
      {
        name: 'infra'
        properties: {
          addressPrefix: infraSubnetCidr
          delegations: [
            {
              name: 'aca'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
        }
      }
      {
        name: 'pe'
        properties: {
          addressPrefix: peSubnetCidr
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// Private DNS zones for the services we make private.
var zoneNames = [
  'privatelink.documents.azure.com'        // Cosmos DB (SQL API)
  'privatelink.blob.${environment().suffixes.storage}' // Storage (blob)
  'privatelink.vaultcore.azure.net'        // Key Vault
]

resource zones 'Microsoft.Network/privateDnsZones@2020-06-01' = [for z in zoneNames: {
  name: z
  location: 'global'
  tags: tags
}]

resource zoneLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for (z, i) in zoneNames: {
  parent: zones[i]
  name: 'link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}]

output vnetId string = vnet.id
output infraSubnetId string = '${vnet.id}/subnets/infra'
output peSubnetId string = '${vnet.id}/subnets/pe'
output cosmosDnsZoneId string = zones[0].id
output blobDnsZoneId string = zones[1].id
output keyvaultDnsZoneId string = zones[2].id
