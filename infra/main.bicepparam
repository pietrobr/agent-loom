using './main.bicep'

param resourcePrefix = readEnvironmentVariable('AZURE_RESOURCE_PREFIX', 'agentloom')
param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'dev')
param location = readEnvironmentVariable('AZURE_LOCATION', 'eastus2')
param principalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')
param foundryModelName = readEnvironmentVariable('FOUNDRY_MODEL_NAME', 'gpt-4o-mini')
param foundryModelVersion = readEnvironmentVariable('FOUNDRY_MODEL_VERSION', '2024-07-18')
param embeddingModelName = readEnvironmentVariable('EMBEDDING_MODEL_NAME', 'text-embedding-3-small')
param embeddingModelVersion = readEnvironmentVariable('EMBEDDING_MODEL_VERSION', '1')
param containerImageTag = readEnvironmentVariable('AZURE_CONTAINER_TAG', 'latest')
param backendExists = bool(readEnvironmentVariable('SERVICE_BACKEND_RESOURCE_EXISTS', 'false'))
param adminExists = bool(readEnvironmentVariable('SERVICE_ADMIN_DESIGNER_RESOURCE_EXISTS', 'false'))
param customerExists = bool(readEnvironmentVariable('SERVICE_CUSTOMER_WEBAPP_RESOURCE_EXISTS', 'false'))
