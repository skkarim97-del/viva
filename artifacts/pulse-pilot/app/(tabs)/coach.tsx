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
  { label: "Should I work out today?", key: "workout" },
  { label: "Why is my recovery low?", key: "hrv" },
  { label: "What should I eat today?", key: "eat" },
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
    if (lower.includes("hrv") || lower.includes("recovery")) responseKey = "hrv";
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
    }, 800);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        <View
          style={[
            styles.msgBubble,
            isUser
              ? { backgroundColor: c.primary, borderBottomRightRadius: 4 }
              : { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderBottomLeftRadius: 4 },
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
          <Text
            style={[
              styles.msgTime,
              { color: isUser ? c.primaryForeground + "88" : c.mutedForeground },
            ]}
          >
            {formatTime(item.timestamp)}
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
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Coach</Text>
        <Text style={[styles.headerSubtitle, { color: c.mutedForeground }]}>
          Personalized advice based on your data.
        </Text>
      </View>

      {showQuickActions ? (
        <ScrollView style={styles.quickActionsContainer} contentContainerStyle={styles.quickInner} showsVerticalScrollIndicator={false}>
          <Text style={[styles.quickPrompt, { color: c.mutedForeground }]}>
            Ask me anything about your health, training, or nutrition.
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
                <Feather name="arrow-right" size={14} color={c.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
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
                <View style={[styles.typingBubble, { backgroundColor: c.card, borderColor: c.border }]}>
                  <View style={styles.typingDots}>
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} />
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.6 }]} />
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.3 }]} />
                  </View>
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
            <Feather name="arrow-up" size={18} color={input.trim() ? c.primaryForeground : c.mutedForeground} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  headerSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  quickActionsContainer: {
    flex: 1,
  },
  quickInner: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  quickPrompt: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  quickGrid: {
    gap: 8,
  },
  quickCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
  },
  quickLabel: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 6,
  },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 2,
  },
  msgRowUser: {
    flexDirection: "row-reverse",
  },
  msgBubble: {
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  msgText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  msgTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    alignSelf: "flex-end",
  },
  typingBubble: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderBottomLeftRadius: 4,
  },
  typingDots: {
    flexDirection: "row",
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
