import { useTheme } from "../theme"

type Props = {
  value: string
  input: (value: string) => void
  submit: () => void
}

export const MaskInput = (props: Props) => {
  const theme = useTheme().theme

  return (
    <box flexDirection="row" height={1} position="relative">
      <text fg={theme.textMuted}>{"> "}</text>
      <input
        value={props.value}
        onInput={props.input}
        onSubmit={props.submit}
        focused
        flexGrow={1}
        textColor={theme.backgroundElement}
        cursorColor={theme.accent}
        backgroundColor={theme.backgroundElement}
        focusedBackgroundColor={theme.backgroundElement}
      />
      <box position="absolute" left={2} top={0} height={1}>
        <text fg={theme.text} bg={theme.backgroundElement}>{"•".repeat(props.value.length)}</text>
      </box>
    </box>
  )
}
