/**
 * Host half of the usage-and-balance bundle.
 *
 * The Host owns no tool, service, or session data for this feature: session
 * token usage arrives through the `tokenUsage` and `contextPressure` session
 * projections, and the account balance through the `accountController`
 * Remote that `@deepseek-ai/dsh-api-account-controller` already provides. The
 * browser half (`./client`) renders both into the composer dock, so this half
 * only has to exist for the loader to mount the row.
 *
 * @module @local/dsh-usage-balance
 */

/**
 * Activate the Host half: nothing to register, so no disposer is returned.
 * @returns Nothing.
 */
export function apply() {}
