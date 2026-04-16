import { ScrollView, ScrollViewProps } from "react-native";
import React from "react";

type Props = ScrollViewProps & {
  children?: React.ReactNode;
  bottomOffset?: number;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  return (
    <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
      {children}
    </ScrollView>
  );
}
