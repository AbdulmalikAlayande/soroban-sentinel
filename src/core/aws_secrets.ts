export interface AWSSecretsResolverConfig {
    region?: string;
    profile?: string;
}

export class AWSSecretsResolver {
    private region: string;
    private profile?: string;
    private clientPromise?: Promise<unknown>;

    constructor(config: AWSSecretsResolverConfig = {}) {
        this.region = config.region || "us-east-1";
        this.profile = config.profile;
    }

    private async getClient() {
        if (!this.clientPromise) {
            this.clientPromise = (async () => {
                const { SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");
                
                const clientConfig: Record<string, unknown> = { region: this.region };
                if (this.profile) {
                    const { fromIni } = await import("@aws-sdk/credential-providers");
                    clientConfig.credentials = fromIni({ profile: this.profile });
                }

                return new SecretsManagerClient(clientConfig as ConstructorParameters<typeof SecretsManagerClient>[0]);
            })();
        }
        return this.clientPromise;
    }

    public async resolveKey(secretId: string): Promise<string> {
        const client = await this.getClient();
        const { GetSecretValueCommand, SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");

        const command = new GetSecretValueCommand({ SecretId: secretId });
        const response = await (client as InstanceType<typeof SecretsManagerClient>).send(command);

        if (!response.SecretString) {
            throw new Error(`SecretString is empty for secret: ${secretId}`);
        }

        return response.SecretString;
    }
}
