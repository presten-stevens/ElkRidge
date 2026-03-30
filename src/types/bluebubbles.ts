export interface BBHandle {
  address: string;
}

export interface BBMessage {
  guid: string;
  text: string | null;
  isFromMe: boolean;
  dateCreated: number;
  handle: { address: string } | null;
}

export interface BBChat {
  guid: string;
  chatIdentifier: string;
  displayName: string | null;
  participants: BBHandle[];
  lastMessage?: BBMessage;
}

export interface BBSocketMessage {
  guid: string;
  text: string | null;
  isFromMe: boolean;
  dateCreated: number;
  dateDelivered: number;
  dateRead: number;
  handle: { address: string } | null;
  chats: Array<{ guid: string }>;
  attachments: Array<{ guid: string; mimeType: string; transferName: string; totalBytes: number }>;
  associatedMessageGuid: string;
  associatedMessageType: string;
  error: number;
}

export interface BBPaginatedResponse<T> {
  data: T[];
  metadata: {
    count: number;
    total: number;
    offset: number;
    limit: number;
  };
}
