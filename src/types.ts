export type ScriptStatus = 
  | 'Ready for Approval' 
  | 'Waiting for Feedback' 
  | 'Approved' 
  | 'Revision Requested' 
  | 'Rejected' 
  | 'Escalated' 
  | 'Call Requested';

export interface Script {
  id: string;
  title: string;
  content: string;
  status: ScriptStatus;
  version: number;
  clientId: string;
  writerId: string;
  createdAt: string;
  updatedAt: string;
  lastFollowUpAt?: string;
  followUpCount: number;
  responseDeadline?: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  preferredChannel: 'WhatsApp' | 'Email';
  slaHours: number;
}

export interface Log {
  id: string;
  scriptId: string;
  timestamp: string;
  action: string;
  message: string;
  channel?: string;
}

export interface RevisionTask {
  id: string;
  scriptId: string;
  writerId: string;
  notes: string;
  status: 'Pending' | 'Completed';
  createdAt: string;
}
