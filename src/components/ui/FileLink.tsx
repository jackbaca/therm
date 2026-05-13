/**
 * FileLink — Generic clickable file reference.
 *
 * Wraps in a box for mouse hit-testing. Opens the source file
 * in the OS default handler when clicked. Underlines on hover.
 */

import { useState, memo } from "react";
import { TextAttributes } from "@opentui/core";
import type { Source } from "../../service/hermes-home";
import { openFile } from "../../utils/open-file";
import { useTheme } from "../../theme";

interface FileLinkProps {
  source: Source;
  children?: string;
}

export const FileLink = memo(({ source, children }: FileLinkProps) => {
  const theme = useTheme().theme;
  const [hovered, setHovered] = useState(false);

  return (
    <box
      height={1}
      onMouseDown={() => openFile(source.file)}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text
        fg={theme.info}
        attributes={hovered ? TextAttributes.UNDERLINE : TextAttributes.NONE}
      >
        {children ?? source.label}
      </text>
    </box>
  );
});

// KV row whose value is a clickable FileLink. Lives beside FileLink
// rather than in ui/kv so that module stays free of data-layer deps.
export const KVLink = (props: { label: string; source: Source; text?: string }) => {
  const theme = useTheme().theme;
  return (
    <box height={1} flexDirection="row">
      <box width={13} flexShrink={0}><text fg={theme.textMuted}>{props.label}</text></box>
      <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
        <FileLink source={props.source}>{props.text ?? props.source.label}</FileLink>
      </box>
    </box>
  );
};
