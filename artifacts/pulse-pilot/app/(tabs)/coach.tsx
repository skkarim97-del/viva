import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { coachResponses } from "@/data/mockData";
import colors from "@/constants/colors";
import type { ChatMessage } from "@/types";

const quickActions = [
  { label: "Should I work out?", key: "workout" },
  { label: "Why is my HRV down?", key: "hrv" },
  { label: "What should I eat?", key: "eat" },
  { label: "Should I fast today?", key: "fast" },
  { label: "Am I overtraining?", key: "overtraining" },
  { label: "Plan my week", key: "week" },
];

export default function CoachScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { chatMessages, addChatMessage, profile } = useApp();
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const sendMessage = (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };
    addChatMessage(userMsg);
    setInput("");

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setIsTyping(true);
    const lower = text.toLowerCase();
    let responseKey = "workout";
    if (lower.includes("hrv")) responseKey = "hrv";
    else if (lower.includes("eat") || lower.includes("nutrition") || lower.includes("food")) responseKey = "eat";
    else if (lower.includes("fast")) responseKey = "fast";
    else if (lower.includes("weight") || lower.includes("losing")) responseKey = "weight";
    else if (lower.includes("overtrain")) responseKey = "overtraining";
    else if (lower.includes("week") || lower.includes("plan")) responseKey = "week";

    setTimeout(() => {
      const botMsg: ChatMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: coachResponses[responseKey] || coachResponses.workout,
        timestamp: Date.now(),
      };
      addChatMessage(botMsg);
      setIsTyping(false);
    }, 1200);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser ? (
          <View style={[styles.avatar, { backgroundColor: c.primary + "15" }]}>
            <Feather name="cpu" size={16} color={c.primary} />
          </View>
        ) : null}
        <View
          style={[
            styles.msgBubble,
            isUser
              ? { backgroundColor: c.primary }
              : { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 },
          ]}
        >
          <Text
            style={[
              styles.msgText,
              { color: isUser ? c.primaryForeground : c.foreground },
            ]}
          >
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  const showQuickActions = chatMessages.length === 0;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={[styles.headerIcon, { backgroundColor: c.primary + "15" }]}>
          <Feather name="message-circle" size={20} color={c.primary} />
        </View>
        <View>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>AI Coach</Text>
          <Text style={[styles.headerSubtitle, { color: c.mutedForeground }]}>
            {profile.tier === "free" ? "Upgrade for unlimited chat" : "Ask me anything"}
          </Text>
        </View>
      </View>

      {showQuickActions ? (
        <View style={styles.quickActionsContainer}>
          <Text style={[styles.quickTitle, { color: c.foreground }]}>Ask your coach</Text>
          <Text style={[styles.quickSubtitle, { color: c.mutedForeground }]}>
            I use your real health data to give personalized advice.
          </Text>
          <View style={styles.quickGrid}>
            {quickActions.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => sendMessage(action.label)}
                style={({ pressed }) => [
                  styles.quickCard,
                  {
                    backgroundColor: c.card,
                    borderColor: c.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.quickLabel, { color: c.foreground }]}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={[...chatMessages].reverse()}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          inverted
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            isTyping ? (
              <View style={[styles.msgRow]}>
                <View style={[styles.avatar, { backgroundColor: c.primary + "15" }]}>
                  <Feather name="cpu" size={16} color={c.primary} />
                </View>
                <View style={[styles.typingBubble, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[styles.typingText, { color: c.mutedForeground }]}>Thinking...</Text>
                </View>
              </View>
            ) : null
          }
        />
      )}

      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: c.background,
            borderTopColor: c.border,
            paddingBottom: bottomPad + 8,
          },
        ]}
      >
        <View style={[styles.inputRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <TextInput
            style={[styles.input, { color: c.foreground }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask your coach..."
            placeholderTextColor={c.mutedForeground}
            onSubmitEditing={() => sendMessage(input)}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => sendMessage(input)}
            style={[styles.sendButton, { backgroundColor: input.trim() ? c.primary : c.muted }]}
          >
            <Feather name="send" size={18} color={input.trim() ? c.primaryForeground : c.mutedForeground} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  quickActionsContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 8,
  },
  quickTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  quickSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 12,
  },
  quickGrid: {
    gap: 10,
  },
  quickCard: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
  },
  quickLabel: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 4,
  },
  msgRowUser: {
    flexDirection: "row-reverse",
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  msgBubble: {
    maxWidth: "78%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  msgText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  typingBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  typingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  inputContainer: {
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    paddingVertical: 12,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
