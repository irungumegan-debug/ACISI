declare module 'africastalking' {
  interface SmsSendOptions {
    to: string[];
    message: string;
    from?: string;
  }

  interface SmsClient {
    send(options: SmsSendOptions): Promise<unknown>;
  }

  interface AfricasTalkingClient {
    SMS: SmsClient;
  }

  interface AfricasTalkingConfig {
    apiKey: string;
    username: string;
  }

  function AfricasTalking(config: AfricasTalkingConfig): AfricasTalkingClient;

  export = AfricasTalking;
}
