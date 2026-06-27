export interface AWSSecretsResolverConfig {
    region?: string;
    profile?: string;
}

export class AWSSecretsResolver {
    private region: string;
    private profile: string;

    constructor(config: AWSSecretsResolverConfig = {}) {
        this.region = config.region || "us-east-1";
        this.profile = config.profile || "default";
    }

    public async resolveKey(secretId: string): Promise<string> {
        // Lazily import AWS SDK modules to keep footprint light
        const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
        const { fromIni } = await import("@aws-sdk/credential-providers");

        const client = new SecretsManagerClient({
            region: this.region,
            credentials: fromIni({ profile: this.profile }),
        });

        const command = new GetSecretValueCommand({ SecretId: secretId });
        const response = await client.send(command);

        if (!response.SecretString) {
            throw new Error(`SecretString is empty for secret: ${secretId}`);
        }

        return response.SecretString;
    }
}
