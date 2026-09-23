import type {
  ConnectionStatus,
  SocialCapability,
  SocialPlatform,
  SocialPublishRequest,
  SocialPublishResult
} from "../../types.js";

export interface SocialConnector {
  id: SocialPlatform;
  checkConnection(): Promise<ConnectionStatus>;
  checkCapabilities(): Promise<SocialCapability>;
  publish(input: SocialPublishRequest): Promise<SocialPublishResult>;
  reply?(input: SocialPublishRequest): Promise<SocialPublishResult>;
}
