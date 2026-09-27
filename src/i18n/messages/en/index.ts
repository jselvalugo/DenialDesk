import { appeals } from "./appeals";
import { auth } from "./auth";
import { claims } from "./claims";
import { common } from "./common";
import { denials } from "./denials";
import { insight } from "./insight";
import { operator } from "./operator";
import { patients } from "./patients";
import { promptPay } from "./promptPay";
import { remittances } from "./remittances";
import { revenue } from "./revenue";
import { settings } from "./settings";
import { shell } from "./shell";
import { welcome } from "./welcome";

export const en = {
  common,
  shell,
  auth,
  welcome,
  denials,
  appeals,
  claims,
  remittances,
  promptPay,
  patients,
  revenue,
  insight,
  settings,
  operator,
} as const;
