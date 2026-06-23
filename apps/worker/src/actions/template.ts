import type { TriggerData } from '@web3-zapier/shared';

/**
 * Replace `{placeholder}` tokens in a message with values from the trigger data.
 * Unknown placeholders are left untouched.
 */
export function renderTemplate(template: string, triggerData: TriggerData): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = (triggerData as Record<string, unknown>)[key];
    return value == null ? `{${key}}` : String(value);
  });
}
