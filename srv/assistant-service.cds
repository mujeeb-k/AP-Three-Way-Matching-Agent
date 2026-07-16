// Conversational interface with persistent messages and action audit records.
using ir from '../db/schema';

@path: '/assistant'
service AssistantService @(requires: ['AP_CLERK', 'AP_MANAGER', 'ADMIN']) {

  // Message history supplied to the assistant.
  type ChatMessage {
    role             : String;       // 'user' | 'assistant'
    content          : String;       // text content
    richContent      : LargeString;  // JSON: rich content block (optional)
    suggestedBubbles : LargeString;  // JSON: [{label, prompt}] (optional)
  }

  // Read-only entity projections
  @readonly entity Conversations as projection on ir.AssistantConversation {
    *, messages, actions
  };

  @readonly entity ConversationMessages as projection on ir.AssistantMessage;
  @readonly entity ConversationActions  as projection on ir.AssistantAction;

  // Chat action with optional conversation persistence.
  action chat(
    message             : String,
    conversationHistory : array of ChatMessage,
    conversationId      : UUID
  ) returns {
    response         : String;
    richContent      : LargeString;
    suggestedBubbles : LargeString;
    conversationId   : UUID;
  };

  // Conversation session management
  action startConversation() returns {
    conversationId : UUID;
  };

  action closeConversation(
    conversationId : UUID
  ) returns {
    success : Boolean;
  };

  function getWelcomeInsights() returns {
    pending         : Integer;
    critical        : Integer;
    autoCorrections : Integer;
  };
}
