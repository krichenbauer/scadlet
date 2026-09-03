/**
 * Gives each explicit OpenSCAD action a monotonically increasing token.
 * UI code checks the token before applying asynchronous results, so an older
 * Render or one-shot Inspect can never overwrite a newer user action.
 */
export class ExecutionGeneration {
  private value = 0

  begin(): number {
    this.value += 1
    return this.value
  }

  invalidate(): void {
    this.value += 1
  }

  isCurrent(token: number): boolean {
    return token === this.value
  }
}
