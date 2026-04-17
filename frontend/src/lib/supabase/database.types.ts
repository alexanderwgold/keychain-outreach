export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          activity_date: string
          activity_type: Database["public"]["Enums"]["activity_type"]
          contact_id: string | null
          created_at: string
          draft_copy: string | null
          id: string
          notes: string | null
          opportunity_id: string
          rep_email: string
          source: Database["public"]["Enums"]["activity_source"]
          subject: string | null
        }
        Insert: {
          activity_date: string
          activity_type: Database["public"]["Enums"]["activity_type"]
          contact_id?: string | null
          created_at?: string
          draft_copy?: string | null
          id?: string
          notes?: string | null
          opportunity_id: string
          rep_email: string
          source: Database["public"]["Enums"]["activity_source"]
          subject?: string | null
        }
        Update: {
          activity_date?: string
          activity_type?: Database["public"]["Enums"]["activity_type"]
          contact_id?: string | null
          created_at?: string
          draft_copy?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string
          rep_email?: string
          source?: Database["public"]["Enums"]["activity_source"]
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      arsenal_items: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string
          id: string
          owner_email: string | null
          sort_order: number
          storage_path: string | null
          tags: string[]
          thumbnail_url: string | null
          title: string
          type: string
          updated_at: string
          url: string
          visibility: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string
          id?: string
          owner_email?: string | null
          sort_order?: number
          storage_path?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title: string
          type: string
          updated_at?: string
          url: string
          visibility: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          owner_email?: string | null
          sort_order?: number
          storage_path?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          type?: string
          updated_at?: string
          url?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "arsenal_items_owner_email_fkey"
            columns: ["owner_email"]
            isOneToOne: false
            referencedRelation: "rep_tokens"
            referencedColumns: ["rep_email"]
          },
        ]
      }
      cadence_rules: {
        Row: {
          auto_followup_on_meeting: boolean
          days_between_touches: number
          id: string
          max_attempts: number
          outreach_template_key: string | null
          stage_name: string
          suggested_action: string | null
        }
        Insert: {
          auto_followup_on_meeting?: boolean
          days_between_touches: number
          id?: string
          max_attempts: number
          outreach_template_key?: string | null
          stage_name: string
          suggested_action?: string | null
        }
        Update: {
          auto_followup_on_meeting?: boolean
          days_between_touches?: number
          id?: string
          max_attempts?: number
          outreach_template_key?: string | null
          stage_name?: string
          suggested_action?: string | null
        }
        Relationships: []
      }
      collateral: {
        Row: {
          created_at: string
          description: string | null
          file_url: string | null
          id: string
          is_active: boolean
          stage_names: string[] | null
          tags: string[] | null
          title: string
          type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
          stage_names?: string[] | null
          tags?: string[] | null
          title: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
          stage_names?: string[] | null
          tags?: string[] | null
          title?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      collateral_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          ip_prefix: string | null
          link_id: string
          referrer: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: number
          ip_prefix?: string | null
          link_id: string
          referrer?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: number
          ip_prefix?: string | null
          link_id?: string
          referrer?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collateral_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "collateral_links"
            referencedColumns: ["id"]
          },
        ]
      }
      collateral_links: {
        Row: {
          active: boolean
          created_at: string
          id: string
          item_id: string
          prospect_email: string | null
          rep_email: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          item_id: string
          prospect_email?: string | null
          rep_email: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          item_id?: string
          prospect_email?: string | null
          rep_email?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "collateral_links_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "arsenal_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collateral_links_rep_email_fkey"
            columns: ["rep_email"]
            isOneToOne: false
            referencedRelation: "rep_tokens"
            referencedColumns: ["rep_email"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          sf_contact_id: string
          title: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          sf_contact_id: string
          title?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          sf_contact_id?: string
          title?: string | null
        }
        Relationships: []
      }
      knowledge_base: {
        Row: {
          account_name: string | null
          content: string
          created_at: string
          embedding: string
          expires_at: string | null
          id: string
          metadata: Json | null
          source_id: string
          source_type: Database["public"]["Enums"]["knowledge_source"]
        }
        Insert: {
          account_name?: string | null
          content: string
          created_at?: string
          embedding: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          source_id: string
          source_type: Database["public"]["Enums"]["knowledge_source"]
        }
        Update: {
          account_name?: string | null
          content?: string
          created_at?: string
          embedding?: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["knowledge_source"]
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          account_name: string
          amount: number | null
          categories: string | null
          close_date: string | null
          company_category: string | null
          created_at: string
          description: string | null
          id: string
          last_sf_sync_at: string | null
          manufacturer_id: string | null
          next_step: string | null
          next_steps_c: string | null
          opp_owner: string
          opportunity_name: string
          rep_email: string | null
          sf_account_id: string | null
          sf_opportunity_id: string
          stage_name: string | null
          updated_at: string
        }
        Insert: {
          account_name: string
          amount?: number | null
          categories?: string | null
          close_date?: string | null
          company_category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          last_sf_sync_at?: string | null
          manufacturer_id?: string | null
          next_step?: string | null
          next_steps_c?: string | null
          opp_owner: string
          opportunity_name: string
          rep_email?: string | null
          sf_account_id?: string | null
          sf_opportunity_id: string
          stage_name?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          amount?: number | null
          categories?: string | null
          close_date?: string | null
          company_category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          last_sf_sync_at?: string | null
          manufacturer_id?: string | null
          next_step?: string | null
          next_steps_c?: string | null
          opp_owner?: string
          opportunity_name?: string
          rep_email?: string | null
          sf_account_id?: string | null
          sf_opportunity_id?: string
          stage_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      opportunity_contacts: {
        Row: {
          contact_id: string
          opportunity_id: string
          primary: boolean
        }
        Insert: {
          contact_id: string
          opportunity_id: string
          primary?: boolean
        }
        Update: {
          contact_id?: string
          opportunity_id?: string
          primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_contacts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_mapping: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_admin: boolean
          rep_email: string
          rep_name: string
          sf_display_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_admin?: boolean
          rep_email: string
          rep_name: string
          sf_display_name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_admin?: boolean
          rep_email?: string
          rep_name?: string
          sf_display_name?: string
        }
        Relationships: []
      }
      rep_style_guides: {
        Row: {
          closing_and_signoff: string
          created_at: string
          example_phrases: string
          generated_from: Json | null
          id: string
          opening_style: string
          rep_email: string
          things_to_avoid: string
          tone_and_voice: string
          updated_at: string
        }
        Insert: {
          closing_and_signoff?: string
          created_at?: string
          example_phrases?: string
          generated_from?: Json | null
          id?: string
          opening_style?: string
          rep_email: string
          things_to_avoid?: string
          tone_and_voice?: string
          updated_at?: string
        }
        Update: {
          closing_and_signoff?: string
          created_at?: string
          example_phrases?: string
          generated_from?: Json | null
          id?: string
          opening_style?: string
          rep_email?: string
          things_to_avoid?: string
          tone_and_voice?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rep_style_guides_rep_email_fkey"
            columns: ["rep_email"]
            isOneToOne: true
            referencedRelation: "rep_tokens"
            referencedColumns: ["rep_email"]
          },
        ]
      }
      rep_tokens: {
        Row: {
          created_at: string
          google_refresh_token: string | null
          id: string
          is_active: boolean
          last_scan_at: string | null
          rep_email: string
          rep_name: string
          scopes: string[] | null
        }
        Insert: {
          created_at?: string
          google_refresh_token?: string | null
          id?: string
          is_active?: boolean
          last_scan_at?: string | null
          rep_email: string
          rep_name: string
          scopes?: string[] | null
        }
        Update: {
          created_at?: string
          google_refresh_token?: string | null
          id?: string
          is_active?: boolean
          last_scan_at?: string | null
          rep_email?: string
          rep_name?: string
          scopes?: string[] | null
        }
        Relationships: []
      }
      supplier_stats: {
        Row: {
          created_at: string
          id: string
          manufacturer_name: string
          tagged_micro_cat_projects_last_365_days: number | null
          tagged_micro_cat_projects_last_90_days: number | null
          tagged_micro_cat_verified_projects_last_365_days: number | null
          tagged_micro_cat_verified_projects_last_90_days: number | null
          tagged_micro_cat_views_last_365_days: number | null
          tagged_micro_cat_views_last_90_days: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manufacturer_name: string
          tagged_micro_cat_projects_last_365_days?: number | null
          tagged_micro_cat_projects_last_90_days?: number | null
          tagged_micro_cat_verified_projects_last_365_days?: number | null
          tagged_micro_cat_verified_projects_last_90_days?: number | null
          tagged_micro_cat_views_last_365_days?: number | null
          tagged_micro_cat_views_last_90_days?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manufacturer_name?: string
          tagged_micro_cat_projects_last_365_days?: number | null
          tagged_micro_cat_projects_last_90_days?: number | null
          tagged_micro_cat_verified_projects_last_365_days?: number | null
          tagged_micro_cat_verified_projects_last_90_days?: number | null
          tagged_micro_cat_views_last_365_days?: number | null
          tagged_micro_cat_views_last_90_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      upcoming_meetings: {
        Row: {
          attendees: Json
          contact_id: string | null
          created_at: string
          followup_drafted: boolean
          id: string
          inferred_type: Database["public"]["Enums"]["meeting_type"]
          meeting_date: string
          meeting_title: string | null
          opportunity_id: string
          rep_email: string
          stage_progression_detected: boolean
          touchpoint_drafted: boolean
        }
        Insert: {
          attendees?: Json
          contact_id?: string | null
          created_at?: string
          followup_drafted?: boolean
          id?: string
          inferred_type?: Database["public"]["Enums"]["meeting_type"]
          meeting_date: string
          meeting_title?: string | null
          opportunity_id: string
          rep_email: string
          stage_progression_detected?: boolean
          touchpoint_drafted?: boolean
        }
        Update: {
          attendees?: Json
          contact_id?: string | null
          created_at?: string
          followup_drafted?: boolean
          id?: string
          inferred_type?: Database["public"]["Enums"]["meeting_type"]
          meeting_date?: string
          meeting_title?: string | null
          opportunity_id?: string
          rep_email?: string
          stage_progression_detected?: boolean
          touchpoint_drafted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "upcoming_meetings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upcoming_meetings_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      search_knowledge: {
        Args: {
          match_account_name?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          account_name: string
          content: string
          id: string
          metadata: Json
          similarity: number
          source_id: string
          source_type: Database["public"]["Enums"]["knowledge_source"]
        }[]
      }
    }
    Enums: {
      activity_source:
        | "gmail_scan"
        | "calendar_scan"
        | "gong_detection"
        | "sf_report"
        | "slack_log"
        | "manual"
      activity_type:
        | "email_sent"
        | "email_received"
        | "reply_received"
        | "meeting_held"
        | "meeting_scheduled"
        | "collateral_shared"
        | "gong_call"
        | "manual_log"
        | "post_meeting_followup"
        | "draft_created"
      knowledge_source: "metabase_report" | "web_research" | "collateral"
      meeting_type:
        | "intro"
        | "meeting"
        | "proposal"
        | "next_steps"
        | "catch_up"
        | "unknown"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_source: [
        "gmail_scan",
        "calendar_scan",
        "gong_detection",
        "sf_report",
        "slack_log",
        "manual",
      ],
      activity_type: [
        "email_sent",
        "email_received",
        "reply_received",
        "meeting_held",
        "meeting_scheduled",
        "collateral_shared",
        "gong_call",
        "manual_log",
        "post_meeting_followup",
        "draft_created",
      ],
      knowledge_source: ["metabase_report", "web_research", "collateral"],
      meeting_type: [
        "intro",
        "meeting",
        "proposal",
        "next_steps",
        "catch_up",
        "unknown",
      ],
    },
  },
} as const
