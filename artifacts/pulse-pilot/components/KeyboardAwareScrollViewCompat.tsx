import { Platform, ScrollView, ScrollViewProps } from "react-native";
import React from "react";

let RNKeyboardAwareScrollView: React.ComponentType<any> | null = null;
try {
  if (Platform.OS !== "web") {
    RNKeyboardAwareScrollView = require("react-native-keyboard-controller").KeyboardAwareScrollView;
  }
} catch {
  RNKeyboardAwareScrollView = null;
}

type Props = ScrollViewProps & {
  children?: React.ReactNode;
  bottomOffset?: number;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  if (RNKeyboardAwareScrollView) {
    return (
      <RNKeyboardAwareScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </RNKeyboardAwareScrollView>
    );
  }
  return (
    <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
      {children}
    </ScrollView>
  );
}
