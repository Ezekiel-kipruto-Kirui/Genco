import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {onValueCreated, onValueWritten} from "firebase-functions/v2/database";
import {setGlobalOptions} from "firebase-functions/v2/options";
import {onSchedule} from "firebase-functions/v2/scheduler";
import nodemailer from "nodemailer";

setGlobalOptions({maxInstances: 10, region: "us-central1"});

admin.initializeApp();

export {getAnalysisSummary} from "./analysis.js";

const DEFAULT_HR_REJECTION_REASON =
  "Rejected by HR because no approval was provided in time.";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGITS_REGEX = /\D+/g;
const ROLE_HR_IDENTIFIERS = new Set([
  "hr",
  "human resource manager",
  "humman resource manager",
  "human resource manger",
  "humman resource manger",
]);
const ROLE_PROJECT_MANAGER_IDENTIFIERS = new Set(["project manager"]);
const ROLE_FINANCE_IDENTIFIERS = new Set(["finance"]);

interface RequisitionRecord {
  status?: string;
  type?: string;
  uid?: string;
  name?: string;
  userName?: string;
  username?: string;
  email?: string;
  requesterEmail?: string;
  userEmail?: string;
  programme?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  telephone?: string;
  contact?: string;
  submittedAt?: number | string;
  approvedAt?: number | string;
  approvedBy?: string;
  approvedByAttribute?: string;
  authorizedBy?: string;
  authorizedByAttribute?: string;
  transactionCompletedBy?: string;
  transactionCompletedAt?: number | string;
  completedBy?: string;
  completedAt?: number | string;
  county?: string;
  subcounty?: string;
  tripPurpose?: string;
  fuelPurpose?: string;
  total?: number | string;
  fuelAmount?: number | string;
  rejectedBy?: string;
  rejectedAt?: number | string;
  rejectionReason?: string;
  rejectionSmsText?: string;
  hrAutoRejected?: boolean;
  [key: string]: unknown;
}

interface FarmerRecord {
  name?: string;
  farmerName?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  telephone?: string;
  contact?: string;
  programme?: string;
  farmerId?: string;
  createdAt?: number | string;
  registrationDate?: number | string;
  [key: string]: unknown;
}

interface UserRecord {
  uid?: string;
  name?: string;
  userName?: string;
  username?: string;
  displayName?: string;
  email?: string;
  role?: string;
  status?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  telephone?: string;
  contact?: string;
  allowedProgrammes?: Record<string, boolean>;
  accessControl?: {
    customAttribute?: string;
    customAttributes?: Record<string, string>;
  };
  [key: string]: unknown;
}

interface SmsOutboxRecord {
  status?: string;
  message?: string;
  recipients?: string[];
  recipientPhones?: string[];
  sourcePage?: string;
  programme?: string;
  createdBy?: string;
  createdAt?: number | string;
  [key: string]: unknown;
}

interface PhoneRecipient {
  phone: string;
  name: string;
}

let transporter: nodemailer.Transporter | null = null;

const getEnv = (name: string): string => (process.env[name] ?? "").trim();

const normalize = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isValidEmail = (value: string): boolean => EMAIL_REGEX.test(value.trim());

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizePhone = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(PHONE_DIGITS_REGEX, "");
  if (!digits) return null;

  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if (digits.startsWith("7") && digits.length === 9) {
    digits = `254${digits}`;
  }

  if (digits.length < 9) return null;
  return hasPlus ? `+${digits}` : digits;
};

const getRoleTokens = (user: UserRecord): string[] => {
  const tokens = new Set<string>();
  const role = normalize(user.role);
  if (role) tokens.add(role);

  const customAttribute = normalize(user.accessControl?.customAttribute);
  if (customAttribute) tokens.add(customAttribute);

  const legacy = user.accessControl?.customAttributes;
  if (legacy && typeof legacy === "object") {
    for (const key of Object.keys(legacy)) {
      const token = normalize(key);
      if (token) tokens.add(token);
    }
  }

  return [...tokens];
};

const hasAnyRoleToken = (
  user: UserRecord,
  allowedTokens: Set<string>,
): boolean =>
  getRoleTokens(user).some((token) => allowedTokens.has(token));

const getUserPhone = (user: UserRecord): string | null => {
  const phoneCandidates = [
    user.phoneNumber,
    user.phone,
    user.mobile,
    user.telephone,
    user.contact,
  ];
  for (const candidate of phoneCandidates) {
    const normalizedPhone = normalizePhone(candidate);
    if (normalizedPhone) return normalizedPhone;
  }
  return null;
};

const getUserDisplayName = (user: UserRecord): string => {
  const candidates = [
    user.name,
    user.userName,
    user.username,
    user.displayName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "Project Manager";
};

const getRequesterPhone = (record: RequisitionRecord): string | null => {
  const phoneCandidates = [
    record.phoneNumber,
    record.phone,
    record.mobile,
    record.telephone,
    record.contact,
  ];
  for (const candidate of phoneCandidates) {
    const normalizedPhone = normalizePhone(candidate);
    if (normalizedPhone) return normalizedPhone;
  }
  return null;
};

const getRequesterName = (record: RequisitionRecord): string =>
  record.name || record.userName || record.username || "Requester";

const getFarmerPhone = (record: FarmerRecord): string | null => {
  const phoneCandidates = [
    record.phoneNumber,
    record.phone,
    record.mobile,
    record.telephone,
    record.contact,
  ];
  for (const candidate of phoneCandidates) {
    const normalizedPhone = normalizePhone(candidate);
    if (normalizedPhone) return normalizedPhone;
  }
  return null;
};

const getFarmerName = (record: FarmerRecord): string => {
  const candidates = [record.name, record.farmerName];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "Farmer";
};

const getUserByKey = async (userKey: string): Promise<UserRecord | null> => {
  const key = userKey.trim();
  if (!key) return null;

  const snapshot = await admin.database().ref(`users/${key}`).get();
  if (!snapshot.exists()) return null;

  return snapshot.val() as UserRecord;
};

const getFirstUserByChild = async (
  childKey: string,
  value: string,
): Promise<UserRecord | null> => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  const snapshot = await admin
    .database()
    .ref("users")
    .orderByChild(childKey)
    .equalTo(trimmedValue)
    .limitToFirst(1)
    .get();

  if (!snapshot.exists()) return null;

  const data = snapshot.val() as Record<string, UserRecord>;
  const first = Object.values(data)[0];
  return first || null;
};

const resolveRequesterPhone = async (
  record: RequisitionRecord,
): Promise<string | null> => {
  const direct = getRequesterPhone(record);
  if (direct) return direct;

  const uid = typeof record.uid === "string" ? record.uid.trim() : "";
  const keyCandidates = [
    uid,
    typeof record.username === "string" ? record.username.trim() : "",
    typeof record.userName === "string" ? record.userName.trim() : "",
  ].filter((value) => value.length > 0);

  try {
    for (const key of keyCandidates) {
      const userData = await getUserByKey(key);
      if (!userData) continue;
      const phone = getUserPhone(userData);
      if (phone) return phone;
    }

    if (uid) {
      const userByUid = await getFirstUserByChild("uid", uid);
      const phoneByUid = userByUid ? getUserPhone(userByUid) : null;
      if (phoneByUid) return phoneByUid;
    }

    const emailCandidates = [
      record.email,
      record.requesterEmail,
      record.userEmail,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    for (const email of emailCandidates) {
      const userByEmail = await getFirstUserByChild("email", email);
      const phoneByEmail = userByEmail ? getUserPhone(userByEmail) : null;
      if (phoneByEmail) return phoneByEmail;

      const emailLower = email.toLowerCase();
      if (emailLower !== email) {
        const userByLowerEmail = await getFirstUserByChild("email", emailLower);
        const phoneByLowerEmail = userByLowerEmail ?
          getUserPhone(userByLowerEmail) :
          null;
        if (phoneByLowerEmail) return phoneByLowerEmail;
      }
    }
  } catch (error) {
    logger.error("Failed requester phone lookup in /users", {uid, error});
  }

  return null;
};

const formatAmount = (record: RequisitionRecord): string => {
  const amount = parseNumber(record.total) ?? parseNumber(record.fuelAmount);
  if (amount == null) return "N/A";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(amount);
};

const formatSubmittedDate = (submittedAt: unknown): string => {
  if (typeof submittedAt === "number" && Number.isFinite(submittedAt)) {
    const parsed = new Date(submittedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-KE", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  }

  if (typeof submittedAt === "string") {
    const trimmed = submittedAt.trim();
    if (!trimmed) return "N/A";

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-KE", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }

    return trimmed;
  }

  return "N/A";
};

const getTransporter = (): nodemailer.Transporter | null => {
  if (transporter) return transporter;

  const host = getEnv("SMTP_HOST");
  const user = getEnv("SMTP_USER");
  const pass = getEnv("SMTP_PASS");
  const portText = getEnv("SMTP_PORT");
  const secureText = normalize(getEnv("SMTP_SECURE"));

  if (!host || !user || !pass) {
    logger.warn(
      "Email skipped. Missing SMTP config. " +
      "Set SMTP_HOST, SMTP_USER, SMTP_PASS.",
    );
    return null;
  }

  const parsedPort = Number.parseInt(portText || "587", 10);
  const port = Number.isNaN(parsedPort) ? 587 : parsedPort;
  const secure = secureText === "true" || port === 465;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {user, pass},
  });

  return transporter;
};

const getSenderAddress = (): string => {
  const sender = getEnv("SMTP_FROM");
  if (sender && isValidEmail(sender)) return sender;
  return getEnv("SMTP_USER");
};

const sendEmail = async (
  recipients: string[],
  subject: string,
  text: string,
  html: string,
): Promise<void> => {
  const validRecipients = [...new Set(
    recipients
      .map((email) => email.trim())
      .filter((email) => isValidEmail(email)),
  )];

  if (validRecipients.length === 0) return;

  const sender = getSenderAddress();
  if (!isValidEmail(sender)) {
    logger.warn("Email skipped. SMTP_FROM/SMTP_USER is missing or invalid.");
    return;
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) return;

  try {
    await activeTransporter.sendMail({
      from: sender,
      to: validRecipients.join(","),
      subject,
      text,
      html,
    });
    logger.info("Email sent", {subject, recipients: validRecipients.length});
  } catch (error) {
    logger.error("Failed to send email", {subject, error});
  }
};

const sendSms = async (
  phoneNumbers: string[],
  message: string,
): Promise<void> => {
  const recipients = [...new Set(
    phoneNumbers
      .map((phone) => normalizePhone(phone))
      .filter((phone): phone is string => !!phone),
  )];

  if (!message.trim() || recipients.length === 0) return;

  const apiKey = getEnv("ROAMTECH_API_KEY");
  const partnerId = getEnv("ROAMTECH_PARTNER_ID");
  const shortcode = getEnv("SHORTCODE");
  const passType = getEnv("ROAMTECH_PASS_TYPE") || "plain";
  const smsUrl = getEnv("ROAMTECH_SMS_URL") || "https://api.v2.emalify.com/api/services/sendsms/";

  if (!apiKey || !partnerId || !shortcode) {
    logger.warn(
      "SMS skipped. Missing ROAMTECH_API_KEY, ROAMTECH_PARTNER_ID " +
      "or SHORTCODE env vars.",
    );
    return;
  }

  const apiMobiles = recipients.map((phone) =>
    phone.startsWith("+") ? phone.slice(1) : phone,
  );

  try {
    const response = await fetch(smsUrl, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        apikey: apiKey,
        partnerID: partnerId,
        mobile: apiMobiles.join(","),
        message,
        shortcode,
        pass_type: passType,
      }),
    });

    const text = await response.text();
    let responseBody: Record<string, unknown> | null = null;
    try {
      responseBody = JSON.parse(text) as Record<string, unknown>;
    } catch (_error) {
      responseBody = null;
    }

    const responseCode =
      responseBody?.["response-code"] ??
      responseBody?.response_code ??
      responseBody?.code;
    const hasSuccessfulResponseCode =
      responseCode === undefined ||
      responseCode === null ||
      responseCode === 200 ||
      responseCode === "200";

    if (!response.ok || !hasSuccessfulResponseCode) {
      logger.error("Failed to send SMS", {
        status: response.status,
        body: text,
        responseCode,
        recipients: recipients.length,
      });
      return;
    }

    logger.info("SMS sent", {
      recipients: recipients.length,
      status: response.status,
      responseCode: responseCode ?? "N/A",
    });
  } catch (error) {
    logger.error("Failed to send SMS", {error, recipients: recipients.length});
  }
};

const userCanHandleProgramme = (
  user: UserRecord,
  programme: string | undefined,
): boolean => {
  if (!programme) return true;
  if (!user.allowedProgrammes) return true;

  const entries = Object.entries(user.allowedProgrammes);
  if (entries.length === 0) return true;

  const target = programme.trim().toLowerCase();
  return entries.some(
    ([key, allowed]) => allowed && key.trim().toLowerCase() === target,
  );
};

const getEmailsByRole = async (
  roleTokens: Set<string>,
  programme: string | undefined,
): Promise<string[]> => {
  const recipients = new Set<string>();

  try {
    const snapshot = await admin.database().ref("users").get();
    if (!snapshot.exists()) return [...recipients];

    const users = snapshot.val() as Record<string, UserRecord>;
    for (const user of Object.values(users)) {
      if (!hasAnyRoleToken(user, roleTokens)) continue;
      if (normalize(user.status) === "inactive") continue;
      if (!userCanHandleProgramme(user, programme)) continue;

      const email = typeof user.email === "string" ? user.email.trim() : "";
      if (isValidEmail(email)) recipients.add(email);
    }
  } catch (error) {
    logger.error(
      "Failed to load role-based email recipients from /users",
      {error},
    );
  }

  return [...recipients];
};

const getPhoneRecipientsByRole = async (
  roleTokens: Set<string>,
  programme: string | undefined,
): Promise<PhoneRecipient[]> => {
  const recipients = new Map<string, string>();

  try {
    const snapshot = await admin.database().ref("users").get();
    if (!snapshot.exists()) return [];

    const users = snapshot.val() as Record<string, UserRecord>;
    for (const user of Object.values(users)) {
      if (!hasAnyRoleToken(user, roleTokens)) continue;
      if (normalize(user.status) === "inactive") continue;
      if (!userCanHandleProgramme(user, programme)) continue;

      const phone = getUserPhone(user);
      if (phone && !recipients.has(phone)) {
        recipients.set(phone, getUserDisplayName(user));
      }
    }
  } catch (error) {
    logger.error(
      "Failed to load role-based phone recipients from /users",
      {error},
    );
  }

  return [...recipients].map(([phone, name]) => ({phone, name}));
};

const sendHrApprovalRequestEmail = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const hrRecipients = await getEmailsByRole(
    ROLE_HR_IDENTIFIERS,
    record.programme,
  );

  if (hrRecipients.length === 0) {
    logger.warn("No HR recipients found for approved requisition", {
      requisitionId,
      programme: record.programme || "N/A",
    });
    return;
  }

  const submittedDate = formatSubmittedDate(record.submittedAt);
  const approvedBy = record.approvedBy || "Name of person who approved";
  const approvedByAttribute =
    typeof record.approvedByAttribute === "string" &&
      record.approvedByAttribute.trim() ?
      record.approvedByAttribute.trim() :
      "N/A";
  const subject = "Requisition Authorization";
  const text = [
    "Dear HR,",
    "",
    "A new requisition has been approved and requires your authorization.",
    "",
    `Requester: ${getRequesterName(record)}`,
    `Date Submitted: ${submittedDate}`,
    `Approved By: ${approvedBy}`,
    `Approved By Attribute: ${approvedByAttribute}`,
    "",
    "Please review and approve at your earliest convenience.",
    "",
    "Regards,",
    approvedBy,
  ].join("\n");
  const html = [
    "<p>Dear HR,</p>",
    "<p>A new requisition has been approved and requires your " +
      "authorization.</p>",
    "<p>",
    `<strong>Requester:</strong> ${getRequesterName(record)}<br/>`,
    `<strong>Date Submitted:</strong> ${submittedDate}<br/>`,
    `<strong>Approved By:</strong> ${approvedBy}<br/>`,
    `<strong>Approved By Attribute:</strong> ${approvedByAttribute}</p>`,
    "<p>Please review and approve at your earliest convenience.</p>",
    `<p>Regards,<br/>${approvedBy}</p>`,
  ].join("");

  await sendEmail(hrRecipients, subject, text, html);
};

const sendHrNewRequisitionEmail = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const hrRecipients = await getEmailsByRole(
    ROLE_HR_IDENTIFIERS,
    record.programme,
  );

  if (hrRecipients.length === 0) {
    logger.warn("No HR recipients found for new requisition", {
      requisitionId,
      programme: record.programme || "N/A",
    });
    return;
  }

  const submittedDate = formatSubmittedDate(record.submittedAt);
  const purpose =
    typeof record.tripPurpose === "string" && record.tripPurpose.trim() ?
      record.tripPurpose.trim() :
      (typeof record.fuelPurpose === "string" && record.fuelPurpose.trim() ?
        record.fuelPurpose.trim() :
        "N/A");
  const county = typeof record.county === "string" && record.county.trim() ?
    record.county.trim() :
    "N/A";
  const subcounty = typeof record.subcounty === "string" &&
      record.subcounty.trim() ?
    record.subcounty.trim() :
    "N/A";
  const subject = "New Requisition Submitted";
  const text = [
    "Dear HR,",
    "",
    "A new requisition has been submitted.",
    "",
    `Requester: ${getRequesterName(record)}`,
    `Programme: ${record.programme || "N/A"}`,
    `Date Submitted: ${submittedDate}`,
    `Type: ${record.type || "N/A"}`,
    `Amount: ${formatAmount(record)}`,
    `Purpose: ${purpose}`,
    `County: ${county}`,
    `Subcounty: ${subcounty}`,
    "",
    "Please review it in the system once it reaches your approval stage.",
  ].join("\n");
  const html = [
    "<p>Dear HR,</p>",
    "<p>A new requisition has been submitted.</p>",
    "<p>",
    `<strong>Requester:</strong> ${getRequesterName(record)}<br/>`,
    `<strong>Programme:</strong> ${record.programme || "N/A"}<br/>`,
    `<strong>Date Submitted:</strong> ${submittedDate}<br/>`,
    `<strong>Type:</strong> ${record.type || "N/A"}<br/>`,
    `<strong>Amount:</strong> ${formatAmount(record)}<br/>`,
    `<strong>Purpose:</strong> ${purpose}<br/>`,
    `<strong>County:</strong> ${county}<br/>`,
    `<strong>Subcounty:</strong> ${subcounty}`,
    "</p>",
    "<p>Please review it in the system once it reaches your approval stage.</p>",
  ].join("");

  await sendEmail(hrRecipients, subject, text, html);
};

const sendProjectManagerNewRequisitionSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const pmRecipients = await getPhoneRecipientsByRole(
    ROLE_PROJECT_MANAGER_IDENTIFIERS,
    record.programme,
  );
  if (pmRecipients.length === 0) {
    logger.warn(
      "Project Manager phone recipients missing for new requisition",
      {requisitionId, programme: record.programme || "N/A"},
    );
    return;
  }

  const requesterName = getRequesterName(record);
  const programme = record.programme || "N/A";

  for (const recipient of pmRecipients) {
    const message = [
      `Hello ${recipient.name}, ${requesterName} has made requisition`,
      `under ${programme} programme please approve it.`,
    ].join(" ");
    await sendSms([recipient.phone], message);
  }
};

const sendRequesterRejectedSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterPhone = await resolveRequesterPhone(record);
  if (!requesterPhone) {
    logger.warn(
      "Requester phone missing for rejected requisition SMS",
      {requisitionId},
    );
    return;
  }

  let customSmsMessage = "";
  if (
    typeof record.rejectionSmsText === "string" &&
    record.rejectionSmsText.trim()
  ) {
    customSmsMessage = record.rejectionSmsText.trim();
  }

  const rejectionReason = typeof record.rejectionReason === "string" &&
      record.rejectionReason.trim() ?
    record.rejectionReason.trim() :
    DEFAULT_HR_REJECTION_REASON;

  const message = customSmsMessage || [
    `Hello ${getRequesterName(record)}.`,
    `Your requisition has been rejected because of ${rejectionReason}.`,
  ].join(" ");

  await sendSms([requesterPhone], message);
};

const sendRequesterAuthorizedSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterPhone = await resolveRequesterPhone(record);
  if (!requesterPhone) {
    logger.warn(
      "Requester phone missing for authorized requisition SMS",
      {requisitionId},
    );
    return;
  }

  const message = [
    `Hello ${getRequesterName(record)}, your requisition has been received ` +
      "and is now being processed.",
    "You will be notified once transaction is completed.Thank you",
  ].join(" ");

  await sendSms([requesterPhone], message);
};

const sendRequesterTransactionCompletedSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterPhone = await resolveRequesterPhone(record);
  if (!requesterPhone) {
    logger.warn(
      "Requester phone missing for transaction completed SMS",
      {requisitionId},
    );
    return;
  }

  const message = [
    `Hello ${getRequesterName(record)}.`,
    "Transaction for your requisition has been completed.",
    `Amount: ${formatAmount(record)}.`,
  ].join(" ");

  await sendSms([requesterPhone], message);
};

const sendLivestockFarmerRegistrationSms = async (
  farmerId: string,
  record: FarmerRecord,
): Promise<void> => {
  const farmerPhone = getFarmerPhone(record);
  if (!farmerPhone) {
    logger.warn(
      "Farmer phone missing for livestock registration SMS",
      {farmerId},
    );
    return;
  }

  const message = `Dear ${getFarmerName(record)}, ` +
    "your registration to the Genco is successful. " +
    "Welcome aboard as we work together to improve livestock value " +
    "and markets.";

  await sendSms([farmerPhone], message);
};

export const processSmsOutboxQueue = onValueWritten(
  "/smsOutbox/{messageId}",
  async (event: any): Promise<void> => {
    const before = event.data.before.val() as SmsOutboxRecord | null;
    const after = event.data.after.val() as SmsOutboxRecord | null;
    if (!after) return;

    const previousStatus = normalize(before?.status);
    const nextStatus = normalize(after.status);

    if (nextStatus && nextStatus !== "pending") return;
    if (previousStatus && previousStatus !== "pending") return;

    const rawRecipients = Array.isArray(after.recipients) ?
      after.recipients :
      (Array.isArray(after.recipientPhones) ? after.recipientPhones : []);
    const recipients = rawRecipients
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const message = typeof after.message === "string" ?
      after.message.trim() :
      "";
    const requestRef = event.data.after.ref;
    const timestamp = Date.now();

    if (!message || recipients.length === 0) {
      await requestRef.update({
        status: "failed",
        failedAt: timestamp,
        failureReason: "Message or recipients missing.",
      });
      return;
    }

    await requestRef.update({
      status: "processing",
      processingAt: timestamp,
      recipientCount: recipients.length,
    });

    await sendSms(recipients, message);

    await requestRef.update({
      status: "sent",
      sentAt: Date.now(),
      recipientCount: recipients.length,
    });
  },
);

export const notifyLivestockFarmerRegistrationSms = onValueCreated(
  "/farmers/{farmerId}",
  async (event): Promise<void> => {
    const after = event.data.val() as FarmerRecord | null;
    if (!after) return;

    const farmerId = String(event.params.farmerId);
    await sendLivestockFarmerRegistrationSms(farmerId, after);
  },
);

const sendFinanceAuthorizedEmail = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const financeRecipients = await getEmailsByRole(
    ROLE_FINANCE_IDENTIFIERS,
    record.programme,
  );

  if (financeRecipients.length === 0) {
    logger.warn("No Finance recipients found for authorized requisition", {
      requisitionId,
      programme: record.programme || "N/A",
    });
    return;
  }

  const submittedDate = formatSubmittedDate(record.submittedAt);
  const authorizedBy = record.authorizedBy || "HR";
  const authorizedByAttribute =
    typeof record.authorizedByAttribute === "string" &&
      record.authorizedByAttribute.trim() ?
      record.authorizedByAttribute.trim() :
      "N/A";
  const subject = "Authorized Requisition";
  const text = [
    "Dear Finance,",
    "",
    "The below requisition has been reviewed and authorized by HR " +
      "and is now ready for financial processing",
    "",
    `Requester: ${getRequesterName(record)}`,
    `Date Submitted: ${submittedDate}`,
    `Amount:${formatAmount(record)}`,
    "",
    "Please log in to the system to access and print the requisition " +
      "documentation for further reference",
    "Kindly proceed with the necessary payment/transaction processing.",
    "",
    "Regards,",
    authorizedBy,
    authorizedByAttribute,
  ].join("\n");
  const html = [
    "<p>Dear Finance,</p>",
    "<p>The below requisition has been reviewed and authorized by HR " +
      "and is now ready for financial processing.</p>",
    "<p>",
    `<strong>Requester:</strong> ${getRequesterName(record)}<br/>`,
    `<strong>Date Submitted:</strong> ${submittedDate}<br/>`,
    `<strong>Amount:</strong> ${formatAmount(record)}<br/>`,
    " </p>",
    "<p>Please log in to the system to access and print the requisition " +
      "documentation for further reference.</p>",
    "<p>Kindly proceed with the necessary payment/transaction processing.</p>",
    `<p>Regards,<br/>${authorizedBy}</p>`,
    `<p>${authorizedByAttribute}</p>`,
  ].join("");

  await sendEmail(financeRecipients, subject, text, html);
};

export const notifyRequisitionStatusEmails = onValueWritten(
  "/requisitions/{requisitionId}",
  async (event: any): Promise<void> => {
    const before = event.data.before.val() as RequisitionRecord | null;
    const after = event.data.after.val() as RequisitionRecord | null;

    if (!after) return;

    const requisitionId = String(event.params.requisitionId);
    const previousStatus = normalize(before?.status);
    const nextStatus = normalize(after.status);
    const previousAuthorizedBy = normalize(before?.authorizedBy);
    const nextAuthorizedBy = normalize(after.authorizedBy);
    const previousTransactionCompletedBy =
      normalize(before?.transactionCompletedBy);
    const nextTransactionCompletedBy = normalize(after.transactionCompletedBy);

    if (!before && after) {
      await Promise.all([
        sendProjectManagerNewRequisitionSms(requisitionId, after),
        sendHrNewRequisitionEmail(requisitionId, after),
      ]);
      return;
    }

    if (nextStatus === "approved") {
      if (previousStatus !== nextStatus) {
        await sendHrApprovalRequestEmail(requisitionId, after);
      }
    }

    if (
      nextStatus === "rejected" &&
      previousStatus !== nextStatus
    ) {
      await sendRequesterRejectedSms(requisitionId, after);
    }

    if (!previousAuthorizedBy && !!nextAuthorizedBy) {
      await Promise.all([
        sendRequesterAuthorizedSms(requisitionId, after),
        sendFinanceAuthorizedEmail(requisitionId, after),
      ]);
    }

    if (!previousTransactionCompletedBy && !!nextTransactionCompletedBy) {
      await sendRequesterTransactionCompletedSms(requisitionId, after);
    }
  },
);

export const autoRejectUnapprovedRequisitions = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Africa/Nairobi",
  },
  async (): Promise<void> => {
    logger.info(
      "HR auto-rejection disabled; approved requisitions no longer time out.",
    );
  },
);
