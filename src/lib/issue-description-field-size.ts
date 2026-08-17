export function fitIssueDescriptionField(textarea: HTMLTextAreaElement) {
  const previousMinHeight = textarea.style.minHeight;
  textarea.style.height = "auto";
  textarea.style.minHeight = "0px";
  const contentHeight = textarea.scrollHeight;
  textarea.style.minHeight =
    contentHeight > 0 ? `${contentHeight}px` : previousMinHeight;
  textarea.style.height = "";
  textarea.scrollTop = 0;
}
