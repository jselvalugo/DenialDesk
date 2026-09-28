import { appeals } from "./appeals";
import { auth } from "./auth";
import { claims } from "./claims";
import { customFields } from "./customFields";
import { common } from "./common";
import { denials } from "./denials";
import { insight } from "./insight";
import { integrations } from "./integrations";
import { operator } from "./operator";
import { patients } from "./patients";
import { promptPay } from "./promptPay";
import { remittances } from "./remittances";
import { revenue } from "./revenue";
import { settings } from "./settings";
import { shell } from "./shell";
import { university } from "./university";
import { welcome } from "./welcome";
import type { Messages } from "../types";

export const es: Messages = {
  common,
  shell,
  auth,
  welcome,
  denials,
  appeals,
  claims,
  customFields,
  remittances,
  promptPay,
  patients,
  revenue,
  insight,
  settings,
  integrations,
  operator,
  university,
};
