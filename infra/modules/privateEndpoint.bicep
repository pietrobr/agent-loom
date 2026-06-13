// =============================================================================
// Generic private endpoint + private DNS zone group.
// Connects a PaaS resource (Cosmos, Storage, ...) into the VNet so the
// Container Apps environment can reach it without public network access.
// =============================================================================
param location string
param name string
param tags object

@description('Subnet that hosts the private endpoint NIC.')
param subnetId string

@description('Resource id of the PaaS service to connect to.')
param serviceId string

@description('Private link group id, e.g. "Sql" (Cosmos) or "blob" (Storage).')
param groupId string

@description('Private DNS zone id to register the endpoint A record into.')
param dnsZoneId string

resource pe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [
      {
        name: name
        properties: {
          privateLinkServiceId: serviceId
          groupIds: [ groupId ]
        }
      }
    ]
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'config'
        properties: { privateDnsZoneId: dnsZoneId }
      }
    ]
  }
}

output id string = pe.id
