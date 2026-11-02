/**
 * OTP delivery/verification behind an interface so a real SMS gateway can be
 * swapped in later. Assumption A7: login uses a mocked provider with a fixed
 * demo OTP that is shown on the login screen. No SMS is ever sent.
 */
export interface OtpProvider {
  /** Send (or pretend to send) an OTP to the phone. */
  send(phone: string): Promise<{ sent: true; demoCode?: string }>;
  /** Check a code entered by the user. */
  verify(phone: string, code: string): Promise<boolean>;
}

export const DEMO_OTP = "123456";

export class MockOtpProvider implements OtpProvider {
  async send(_phone: string) {
    return { sent: true as const, demoCode: DEMO_OTP };
  }

  async verify(_phone: string, code: string) {
    return code === DEMO_OTP;
  }
}

export const otpProvider: OtpProvider = new MockOtpProvider();
