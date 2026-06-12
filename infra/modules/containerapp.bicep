param location string
param name string
param environmentId string
param identityId string
param acrLoginServer string
param image string
param targetPort int
param externalIngress bool = true
param tags object
param envVars array = []
param minReplicas int = 0
param maxReplicas int = 3

// On the first provision the app image is not yet in ACR (azd pushes it during
// the deploy step). Use a public placeholder until the service exists; azd then
// updates the revision with the real image.
param exists bool = false
var placeholderImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var effectiveImage = exists ? image : placeholderImage

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: externalIngress
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: [
        { server: acrLoginServer, identity: identityId }
      ]
    }
    template: {
      containers: [
        {
          name: name
          image: effectiveImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: envVars
        }
      ]
      scale: { minReplicas: minReplicas, maxReplicas: maxReplicas }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output id string = app.id
