'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Building2, ShieldCheck, Bell, Users } from 'lucide-react';
import { Field, FormGrid, Select, TextInput, TextArea, Checkbox, ResultAlert } from './fields';
import {
  saveOrgSettingsAction,
  saveSecuritySettingsAction,
  saveNotificationSettingsAction,
  saveMinutesOcrSettingsAction,
  saveGuarantorSettingsAction,
  saveSettingGroupAction,
} from '@/server/actions/admin';
import type { ActionResult } from '@/server/actions/auth';

/* ------------------------------------------------------------------ *
 * Organisation profile
 * ------------------------------------------------------------------ */
export function OrganisationSettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveOrgSettingsAction as any, undefined as ActionResult | undefined);
  const s = settings || {};
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <FormGrid cols={2}>
        <Field label="Organisation name" required><TextInput name="name" required defaultValue={s.name || 'Catholic Men Association (CMA)'} /></Field>
        <Field label="Short name"><TextInput name="short_name" defaultValue={s.short_name || 'CMA'} /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Motto"><TextInput name="motto" defaultValue={s.motto} placeholder="e.g. Men of Faith and Service" /></Field>
        <Field label="Timezone"><TextInput name="timezone" defaultValue={s.timezone || 'Africa/Nairobi'} /></Field>
      </FormGrid>
      <Field label="Address"><TextArea name="address" defaultValue={s.address} placeholder="Parish address" /></Field>
      <FormGrid cols={3}>
        <Field label="Phone"><TextInput name="phone" defaultValue={s.phone} /></Field>
        <Field label="Email"><TextInput name="email" type="email" defaultValue={s.email} /></Field>
        <Field label="Currency symbol"><TextInput name="currency_symbol" defaultValue={s.currency_symbol || 'KSh'} /></Field>
      </FormGrid>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-navy-800">Organisational hierarchy</p>
        <FormGrid cols={2}>
          <Field label="Archdiocese"><TextInput name="archdiocese" defaultValue={s.archdiocese} /></Field>
          <Field label="Diocese"><TextInput name="diocese" defaultValue={s.diocese} /></Field>
          <Field label="Deanery"><TextInput name="deanery" defaultValue={s.deanery} /></Field>
          <Field label="Parish"><TextInput name="parish" defaultValue={s.parish} /></Field>
        </FormGrid>
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-navy-800">Payment details (shown on receipts)</p>
        <FormGrid cols={2}>
          <Field label="M-Pesa paybill"><TextInput name="mpesa_paybill" defaultValue={s.mpesa_paybill} /></Field>
          <Field label="M-Pesa account prefix"><TextInput name="mpesa_account_prefix" defaultValue={s.mpesa_account_prefix} /></Field>
          <Field label="Bank name"><TextInput name="bank_name" defaultValue={s.bank_name} /></Field>
          <Field label="Bank account"><TextInput name="bank_account" defaultValue={s.bank_account} /></Field>
          <Field label="Bank branch"><TextInput name="bank_branch" defaultValue={s.bank_branch} /></Field>
          <Field label="Logo URL"><TextInput name="logo_url" defaultValue={s.logo_url} placeholder="https://…" /></Field>
        </FormGrid>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save organisation profile
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Security policy
 * ------------------------------------------------------------------ */
export function SecuritySettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveSecuritySettingsAction as any, undefined as ActionResult | undefined);
  const s = settings || {};
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <FormGrid cols={3}>
        <Field label="Minimum password length"><TextInput name="password_min_length" type="number" min={6} step="1" defaultValue={s.password_min_length ?? 8} /></Field>
        <Field label="Session timeout (hours)"><TextInput name="session_timeout_hours" type="number" min={1} step="1" defaultValue={s.session_timeout_hours ?? s.session_hours ?? 12} /></Field>
        <Field label="Max failed logins"><TextInput name="max_failed_attempts" type="number" min={2} step="1" defaultValue={s.max_failed_attempts ?? 5} /></Field>
      </FormGrid>
      <FormGrid cols={3}>
        <Field label="Lockout (minutes)"><TextInput name="lockout_minutes" type="number" min={1} step="1" defaultValue={s.lockout_minutes ?? 30} /></Field>
        <Field label="Audit retention (days)"><TextInput name="audit_retention_days" type="number" min={30} step="1" defaultValue={s.audit_retention_days ?? 730} /></Field>
        <Field label="Force password reset (days)"><TextInput name="force_password_reset_days" type="number" min={0} step="1" defaultValue={s.force_password_reset_days ?? 180} /></Field>
      </FormGrid>
      <div className="grid gap-2 sm:grid-cols-2">
        <Checkbox name="password_require_number" label="Password requires a number" defaultChecked={s.password_require_number !== false} />
        <Checkbox name="password_require_special" label="Password requires a special character" defaultChecked={Boolean(s.password_require_special)} />
        <Checkbox name="two_factor_enabled" label="Enable two-factor authentication (2FA-ready)" defaultChecked={Boolean(s.two_factor_enabled)} />
        <Checkbox name="encrypt_sensitive_fields" label="Encrypt sensitive fields at rest" hint="Kenya DPA 2019 safeguard" defaultChecked={s.encrypt_sensitive_fields !== false} />
        <Checkbox name="dpa_consent_required" label="Require DPA consent on registration" defaultChecked={s.dpa_consent_required !== false} />
      </div>
      <Field label="Data protection notice"><TextArea name="data_protection_notice" defaultValue={s.data_protection_notice || 'Personal data is processed under the Kenya Data Protection Act, 2019.'} /></Field>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save security policy
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Notification channels
 * ------------------------------------------------------------------ */
export function NotificationSettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveNotificationSettingsAction as any, undefined as ActionResult | undefined);
  const s = settings || {};
  const ch = s.channels || {};
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Checkbox name="in_system_enabled" label="In-system" defaultChecked={ch.in_system !== false || s.in_system_enabled !== false} />
        <Checkbox name="sms_enabled" label="SMS" defaultChecked={Boolean(ch.sms || s.sms_enabled)} />
        <Checkbox name="email_enabled" label="Email" defaultChecked={Boolean(ch.email || s.email_enabled)} />
        <Checkbox name="whatsapp_enabled" label="WhatsApp" defaultChecked={Boolean(ch.whatsapp || s.whatsapp_enabled)} />
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-navy-800">SMS provider</p>
        <FormGrid cols={2}>
          <Field label="Provider">
            <Select name="sms_provider" defaultValue={s.sms_provider || 'none'} options={[
              { value: 'none', label: 'Disabled' },
              { value: 'africastalking', label: "Africa's Talking" },
              { value: 'twilio', label: 'Twilio' },
              { value: 'generic', label: 'Generic HTTP' },
            ]} />
          </Field>
          <Field label="Sender ID / From"><TextInput name="sms_sender_id" defaultValue={s.sms_sender_id || 'CMA'} /></Field>
          <Field label="Account / username" hint="Africa’s Talking username or Twilio Account SID"><TextInput name="sms_username" defaultValue={s.sms_username || ''} /></Field>
          <Field label="API key" hint="Africa’s Talking API key, Twilio Account SID or generic bearer key"><TextInput name="sms_api_key" type="password" placeholder="••••••••" /></Field>
          <Field label="API secret" hint="Twilio auth token; leave blank to keep the current secret"><TextInput name="sms_api_secret" type="password" placeholder="••••••••" /></Field>
          <Field label="Generic endpoint URL" hint="Required only for Generic HTTP"><TextInput name="sms_api_url" defaultValue={s.sms_api_url || ''} placeholder="https://sms.example.org/send" /></Field>
        </FormGrid>
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-navy-800">Email (SMTP)</p>
        <FormGrid cols={2}>
          <Field label="SMTP host"><TextInput name="smtp_host" defaultValue={s.smtp_host} /></Field>
          <Field label="SMTP port"><TextInput name="smtp_port" type="number" min={1} step="1" defaultValue={s.smtp_port ?? 587} /></Field>
          <Field label="SMTP user"><TextInput name="smtp_user" defaultValue={s.smtp_user} /></Field>
          <Field label="SMTP password" hint="Leave blank to keep the current secret"><TextInput name="smtp_password" type="password" placeholder="••••••••" /></Field>
          <Field label="From address"><TextInput name="smtp_from" defaultValue={s.smtp_from || 'no-reply@cma.or.ke'} /></Field>
        </FormGrid>
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-navy-800">WhatsApp Cloud API</p>
        <FormGrid cols={2}>
          <Field label="Provider"><Select name="whatsapp_provider" defaultValue={s.whatsapp_provider || 'meta'} options={[{ value: 'meta', label: 'Meta WhatsApp Cloud API' }, { value: 'none', label: 'Disabled' }]} /></Field>
          <Field label="Phone number ID"><TextInput name="whatsapp_phone_id" defaultValue={s.whatsapp_phone_id} /></Field>
          <Field label="Access token" hint="Leave blank to keep the current secret"><TextInput name="whatsapp_token" type="password" placeholder="••••••••" /></Field>
        </FormGrid>
        <p className="hint">Meta requires members’ WhatsApp consent and, outside the 24-hour customer-service window, an approved message template. Delivery results are recorded in the communication log.</p>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save notification channels
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Handwritten meeting-minutes OCR
 * ------------------------------------------------------------------ */
export function MinutesOcrSettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveMinutesOcrSettingsAction as any, undefined as ActionResult | undefined);
  const s = settings || {};
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 text-sm text-slate-600">
        Secretaries can upload a handwritten scan from a meeting page. OCR creates a draft only — it must be checked and saved before it is published or shared.
      </div>
      <FormGrid cols={2}>
        <Field label="OCR provider">
          <Select name="provider" defaultValue={s.provider || 'none'} options={[
            { value: 'none', label: 'Not configured — manual transcription' },
            { value: 'google_vision', label: 'Google Cloud Vision (images)' },
            { value: 'generic', label: 'Generic / on-premise OCR endpoint' },
          ]} />
        </Field>
        <Field label="API key" hint="Leave blank to retain the saved secret.">
          <TextInput name="api_key" type="password" placeholder="••••••••" />
        </Field>
      </FormGrid>
      <Field
        label="Endpoint URL"
        hint="Optional for Google Cloud Vision; required for Generic. Generic OCR receives a multipart `file` and must return JSON with `text`."
      >
        <TextInput name="api_url" defaultValue={s.api_url || ''} placeholder="https://ocr.example.org/v1/read" />
      </Field>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save OCR settings
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Guarantor policy
 * ------------------------------------------------------------------ */
export function GuarantorSettingsForm({ settings }: { settings: any }) {
  const [state, action, pending] = useActionState(saveGuarantorSettingsAction as any, undefined as ActionResult | undefined);
  const s = settings || {};
  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <FormGrid cols={3}>
        <Field label="Minimum guarantors"><TextInput name="min_guarantors" type="number" min={0} step="1" defaultValue={s.min_guarantors ?? 2} /></Field>
        <Field label="Maximum guarantors"><TextInput name="max_guarantors" type="number" min={1} step="1" defaultValue={s.max_guarantors ?? 5} /></Field>
        <Field label="Max exposure per guarantor (KSh)"><TextInput name="max_exposure_per_guarantor" type="number" min={0} step="0.01" defaultValue={s.max_exposure_per_guarantor ?? 0} /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Guarantor max own outstanding (KSh)" hint="A member cannot guarantee if their own loans exceed this"><TextInput name="guarantor_max_outstanding" type="number" min={0} step="0.01" defaultValue={s.guarantor_max_outstanding ?? 0} /></Field>
        <Field label="Max exposure multiple of savings"><TextInput name="max_exposure_multiple" type="number" min={0} step="0.5" defaultValue={s.max_exposure_multiple ?? 3} /></Field>
      </FormGrid>
      <div className="grid gap-2 sm:grid-cols-2">
        <Checkbox name="guarantor_must_be_active_member" label="Guarantor must be an active member" defaultChecked={s.guarantor_must_be_active_member !== false} />
        <Checkbox name="guarantor_approval_required" label="Guarantor must explicitly accept" defaultChecked={s.guarantor_approval_required !== false} />
        <Checkbox name="guarantor_self_guarantee" label="Allow self-guarantee" defaultChecked={Boolean(s.guarantor_self_guarantee)} />
        <Checkbox name="count_savings_as_capacity" label="Count savings toward guarantee capacity" defaultChecked={s.count_savings_as_capacity !== false} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save guarantor policy
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Generic settings group (serialises fields to a JSON payload)
 * ------------------------------------------------------------------ */
export interface GroupField {
  name: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function SettingsGroupForm({
  settingKey,
  groupName,
  fields,
  initial,
  title,
}: {
  settingKey: string;
  groupName: string;
  fields: GroupField[];
  initial: Record<string, any>;
  title: string;
}) {
  const [state, action, pending] = useActionState(saveSettingGroupAction as any, undefined as ActionResult | undefined);
  const [values, setValues] = useState<Record<string, any>>(() => {
    const v: Record<string, any> = {};
    for (const f of fields) {
      v[f.name] = initial[f.name] ?? (f.type === 'checkbox' ? false : f.type === 'number' ? 0 : '');
    }
    return v;
  });

  const payload = useMemo(() => {
    const out: Record<string, any> = { ...initial };
    for (const f of fields) {
      if (f.type === 'checkbox') out[f.name] = Boolean(values[f.name]);
      else if (f.type === 'number') out[f.name] = Number(values[f.name] || 0);
      else out[f.name] = values[f.name];
    }
    return JSON.stringify(out);
  }, [values, fields, initial]);

  function set(name: string, val: any) {
    setValues((v) => ({ ...v, [name]: val }));
  }

  return (
    <form action={action} className="space-y-4">
      <ResultAlert result={state} />
      <input type="hidden" name="setting_key" value={settingKey} />
      <input type="hidden" name="group_name" value={groupName} />
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => {
          if (f.type === 'checkbox') {
            return (
              <div key={f.name} className="flex items-end">
                <Checkbox name={f.name} label={f.label} hint={f.hint} defaultChecked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
              </div>
            );
          }
          if (f.type === 'select') {
            return (
              <Field key={f.name} label={f.label} hint={f.hint}>
                <Select name={f.name} value={values[f.name]} options={f.options || []} onChange={(e) => set(f.name, e.target.value)} />
              </Field>
            );
          }
          return (
            <Field key={f.name} label={f.label} hint={f.hint}>
              <TextInput
                name={f.name}
                type={f.type === 'number' ? 'number' : 'text'}
                min={f.min}
                max={f.max}
                step={f.step ?? (f.type === 'number' ? 1 : undefined)}
                value={values[f.name]}
                onChange={(e) => set(f.name, e.target.value)}
              />
            </Field>
          );
        })}
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save {title}
      </button>
    </form>
  );
}
