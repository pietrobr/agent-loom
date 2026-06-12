param location string
param logAnalyticsName string
param appInsightsName string
param tags object

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource ai 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output logAnalyticsId          string = law.id
output logAnalyticsCustomerId  string = law.properties.customerId
#disable-next-line outputs-should-not-contain-secrets
output logAnalyticsSharedKey   string = law.listKeys().primarySharedKey
output appInsightsConnection   string = ai.properties.ConnectionString
