export interface Conversation {
  id: string;
  contact: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  sender: string;
  body: string;
  timestamp: string;
  isFromMe: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
}
