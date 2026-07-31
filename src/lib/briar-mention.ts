export function mentionsBriar(body: string) {
  return /(^|[^\p{L}\p{N}_])@briar(?=$|[^\p{L}\p{N}_])/iu.test(body);
}
