#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "../..");
const cli = join(repoRoot, "packages/cli/dist/index.js");
const defaultCloneUrl = "https://github.com/Daewooox/WalletAssignment.git";

function option(argv, name, fallback) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, "utf8");
}

function run(root, command, args, input = "") {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runCli(root, args, input = "") {
  return run(root, process.execPath, [cli, ...args], input);
}

function shellQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function manualReplayCommands(root) {
  return [
    `cd ${shellQuote(root)}`,
    `SCOPELOCK_CLI=${shellQuote(cli)}`,
    `node "$SCOPELOCK_CLI" agents preflight --manifest .scopelock/agents.json`,
    `node "$SCOPELOCK_CLI" plan-parallel plan.json --include-read-hazards`,
    `node "$SCOPELOCK_CLI" run --plan plan.json --receipt .scopelock/reports/manual-rerun.json --no-check-drift`,
    `node "$SCOPELOCK_CLI" check-drift`,
    "swift test",
  ];
}

function keepFixtureHint(root) {
  return [
    "",
    `Fixture kept: ${root}`,
    "Manual replay without global `scopelock` install:",
    ...manualReplayCommands(root).map((command) => `  ${command}`),
    "",
    "Already generated evidence:",
    "  .scopelock/reports/wallet-blocked.json",
    "  .scopelock/reports/wallet-final.json",
  ];
}

function mustRun(root, command, args, input = "") {
  const result = run(root, command, args, input);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function git(root, args) {
  return mustRun(root, "git", args);
}

function hasCommand(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function cloneSource(dest, argv) {
  const sourceDir = option(argv, "--source-dir", null);
  if (sourceDir !== null) {
    cpSync(resolve(sourceDir), dest, { recursive: true });
    return "source-dir";
  }
  if (argv.includes("--offline-fixture")) {
    createEmbeddedWalletAssignment(dest);
    return "embedded";
  }
  const cloneUrl = option(argv, "--clone-url", defaultCloneUrl);
  const cloned = run(dirname(dest), "git", ["clone", "--depth", "1", cloneUrl, dest]);
  if (cloned.status === 0) return cloneUrl;
  createEmbeddedWalletAssignment(dest);
  return "embedded-fallback";
}

function createEmbeddedWalletAssignment(root) {
  mkdirSync(root, { recursive: true });
  write(root, ".gitignore", ".build/\n.DS_Store\n");
  write(root, "Package.swift", `// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "WalletAssignment",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "WalletCore", targets: ["WalletCore"]),
        .executable(name: "WalletAssignment", targets: ["WalletAssignment"]),
    ],
    targets: [
        .target(name: "WalletCore"),
        .executableTarget(name: "WalletAssignment", dependencies: ["WalletCore"]),
        .testTarget(name: "WalletCoreTests", dependencies: ["WalletCore"]),
    ]
)
`);
  write(root, "README.md", `# WalletAssignment

Small Swift package modeling wallet transitions with deterministic validation.

## How to run

\`\`\`bash
swift test
\`\`\`
`);
  write(root, "Sources/WalletCore/WalletTypes.swift", `import Foundation

public typealias WalletIdentifier = String
public typealias TransactionIdentifier = String
public typealias Signature = String
public typealias Amount = UInt64

public struct TransactionProposal: Sendable, Equatable {
    public let id: TransactionIdentifier
    public let from: WalletIdentifier
    public let to: WalletIdentifier
    public let amount: Amount
    public let nonce: UInt64
    public let signature: Signature

    public init(id: TransactionIdentifier, from: WalletIdentifier, to: WalletIdentifier, amount: Amount, nonce: UInt64, signature: Signature) {
        self.id = id
        self.from = from
        self.to = to
        self.amount = amount
        self.nonce = nonce
        self.signature = signature
    }
}

public struct SignatureVerificationRequest: Sendable, Equatable {
    public let signer: WalletIdentifier
    public let message: String
    public let signature: Signature

    public init(signer: WalletIdentifier, message: String, signature: Signature) {
        self.signer = signer
        self.message = message
        self.signature = signature
    }
}

public protocol SignatureVerifying: Sendable {
    func verify(_ request: SignatureVerificationRequest) -> Bool
}

public struct DeterministicSignatureVerifier: SignatureVerifying {
    public init() {}
    public func verify(_ request: SignatureVerificationRequest) -> Bool {
        request.signature == Self.sign(signer: request.signer, message: request.message)
    }
    public static func sign(signer: WalletIdentifier, message: String) -> Signature {
        "signed:\\(signer):\\(message)"
    }
}
`);
  write(root, "Sources/WalletCore/WalletState.swift", `import Foundation

public enum WalletLifecycleState: Sendable, Equatable {
    case active
    case locked
}

public struct WalletState: Sendable, Equatable {
    public let walletID: WalletIdentifier
    public let balance: Amount
    public let nextExpectedNonce: UInt64
    public let lifecycleState: WalletLifecycleState
    public let recentTransactionIDs: [TransactionIdentifier]
    public let transactionHistoryLimit: Int

    public init(walletID: WalletIdentifier, balance: Amount, nextExpectedNonce: UInt64 = 0, lifecycleState: WalletLifecycleState = .active, recentTransactionIDs: [TransactionIdentifier] = [], transactionHistoryLimit: Int = 32) {
        self.walletID = walletID
        self.balance = balance
        self.nextExpectedNonce = nextExpectedNonce
        self.lifecycleState = lifecycleState
        self.recentTransactionIDs = recentTransactionIDs
        self.transactionHistoryLimit = transactionHistoryLimit
    }

    public func withLifecycleState(_ lifecycleState: WalletLifecycleState) -> WalletState {
        WalletState(walletID: walletID, balance: balance, nextExpectedNonce: nextExpectedNonce, lifecycleState: lifecycleState, recentTransactionIDs: recentTransactionIDs, transactionHistoryLimit: transactionHistoryLimit)
    }

    public func containsRecentTransactionID(_ id: TransactionIdentifier) -> Bool {
        recentTransactionIDs.contains(id)
    }

    public func recordingAppliedTransaction(id: TransactionIdentifier, debitedAmount: Amount) -> WalletState {
        let history = Array((recentTransactionIDs + [id]).suffix(transactionHistoryLimit))
        return WalletState(walletID: walletID, balance: balance - debitedAmount, nextExpectedNonce: nextExpectedNonce + 1, lifecycleState: lifecycleState, recentTransactionIDs: history, transactionHistoryLimit: transactionHistoryLimit)
    }
}

public enum WalletEvent: Sendable, Equatable {
    case lock
    case unlock
    case applyTransaction(TransactionProposal)
}

public struct WalletTransition: Sendable, Equatable {
    public let event: WalletEvent
    public let previousState: WalletState
    public let nextState: WalletState
}
`);
  write(root, "Sources/WalletCore/WalletError.swift", `import Foundation

public enum WalletError: Error, Sendable, Equatable {
    case insufficientBalance(available: Amount, requested: Amount)
    case invalidNonce(expected: UInt64, received: UInt64)
    case duplicateTransaction(id: TransactionIdentifier)
    case invalidSignature
    case walletLocked
    case selfTransferAttempt
    case invalidAmount
    case unsupportedSender(expected: WalletIdentifier, received: WalletIdentifier)
}
`);
  write(root, "Sources/WalletCore/WalletStateMachine.swift", `import Foundation

public struct WalletStateMachine: Sendable {
    private let verifier: any SignatureVerifying

    public init(verifier: any SignatureVerifying) {
        self.verifier = verifier
    }

    public func transition(from state: WalletState, event: WalletEvent) throws -> WalletTransition {
        let nextState: WalletState
        switch event {
        case .lock:
            nextState = state.withLifecycleState(.locked)
        case .unlock:
            nextState = state.withLifecycleState(.active)
        case let .applyTransaction(transaction):
            nextState = try apply(transaction, to: state)
        }
        return WalletTransition(event: event, previousState: state, nextState: nextState)
    }

    public func canonicalMessage(for transaction: TransactionProposal) -> String {
        [
            "id=\\(transaction.id)",
            "from=\\(transaction.from)",
            "to=\\(transaction.to)",
            "amount=\\(transaction.amount)",
            "nonce=\\(transaction.nonce)"
        ].joined(separator: "|")
    }

    private func apply(_ transaction: TransactionProposal, to state: WalletState) throws -> WalletState {
        guard state.lifecycleState == .active else { throw WalletError.walletLocked }
        guard transaction.from == state.walletID else { throw WalletError.unsupportedSender(expected: state.walletID, received: transaction.from) }
        guard transaction.from != transaction.to else { throw WalletError.selfTransferAttempt }
        guard transaction.amount > 0 else { throw WalletError.invalidAmount }
        guard !state.containsRecentTransactionID(transaction.id) else { throw WalletError.duplicateTransaction(id: transaction.id) }
        guard transaction.nonce == state.nextExpectedNonce else { throw WalletError.invalidNonce(expected: state.nextExpectedNonce, received: transaction.nonce) }
        guard state.balance >= transaction.amount else { throw WalletError.insufficientBalance(available: state.balance, requested: transaction.amount) }
        let request = SignatureVerificationRequest(signer: transaction.from, message: canonicalMessage(for: transaction), signature: transaction.signature)
        guard verifier.verify(request) else { throw WalletError.invalidSignature }
        return state.recordingAppliedTransaction(id: transaction.id, debitedAmount: transaction.amount)
    }
}
`);
  write(root, "Sources/WalletCore/WalletActor.swift", `import Foundation

public actor WalletActor {
    private let stateMachine: WalletStateMachine
    private var state: WalletState

    public init(initialState: WalletState, verifier: any SignatureVerifying) {
        self.state = initialState
        self.stateMachine = WalletStateMachine(verifier: verifier)
    }

    public func snapshot() -> WalletState { state }

    @discardableResult public func apply(_ transaction: TransactionProposal) throws -> WalletTransition {
        try perform(.applyTransaction(transaction))
    }

    private func perform(_ event: WalletEvent) throws -> WalletTransition {
        let transition = try stateMachine.transition(from: state, event: event)
        state = transition.nextState
        return transition
    }
}
`);
  write(root, "Sources/WalletAssignment/WalletAssignmentDemo.swift", `import WalletCore

@main
struct WalletAssignmentDemo {
    static func main() {
        print("WalletAssignment demo")
    }
}
`);
  write(root, "Tests/WalletCoreTests/WalletCoreTests.swift", `import XCTest
@testable import WalletCore

final class WalletCoreTests: XCTestCase {
    private let verifier = DeterministicSignatureVerifier()

    func testSuccessfulTransactionApplication() throws {
        let stateMachine = WalletStateMachine(verifier: verifier)
        let initialState = WalletState(walletID: "alex", balance: 100, nextExpectedNonce: 4)
        let transaction = makeSignedTransaction(id: "trscn-success", from: "alex", to: "bob", amount: 30, nonce: 4, stateMachine: stateMachine)
        let transition = try stateMachine.transition(from: initialState, event: .applyTransaction(transaction))
        XCTAssertEqual(transition.nextState.balance, 70)
        XCTAssertEqual(transition.nextState.nextExpectedNonce, 5)
        XCTAssertEqual(transition.nextState.recentTransactionIDs, ["trscn-success"])
    }

    func testExactReplayAttemptFailsWithDuplicateTransaction() throws {
        let stateMachine = WalletStateMachine(verifier: verifier)
        let initialState = WalletState(walletID: "alex", balance: 100, nextExpectedNonce: 0)
        let transaction = makeSignedTransaction(id: "trscn-replay", from: "alex", to: "bob", amount: 10, nonce: 0, stateMachine: stateMachine)
        let applied = try stateMachine.transition(from: initialState, event: .applyTransaction(transaction))
        XCTAssertThrowsError(try stateMachine.transition(from: applied.nextState, event: .applyTransaction(transaction)))
    }

    func testActorRejectsConcurrentReplayAttempt() async throws {
        func applyResult(_ transaction: TransactionProposal, using wallet: WalletActor) async -> Result<WalletTransition, Error> {
            do {
                return .success(try await wallet.apply(transaction))
            } catch {
                return .failure(error)
            }
        }

        let wallet = WalletActor(initialState: WalletState(walletID: "alex", balance: 100), verifier: verifier)
        let stateMachine = WalletStateMachine(verifier: verifier)
        let transaction = makeSignedTransaction(id: "trscn-concurrent", from: "alex", to: "bob", amount: 10, nonce: 0, stateMachine: stateMachine)
        async let first: Result<WalletTransition, Error> = applyResult(transaction, using: wallet)
        async let second: Result<WalletTransition, Error> = applyResult(transaction, using: wallet)
        let successes = await [first, second].compactMap { try? $0.get() }
        XCTAssertEqual(successes.count, 1)
    }

    private func makeSignedTransaction(id: String, from: String, to: String, amount: Amount, nonce: UInt64, stateMachine: WalletStateMachine) -> TransactionProposal {
        let unsigned = TransactionProposal(id: id, from: from, to: to, amount: amount, nonce: nonce, signature: "")
        return TransactionProposal(id: id, from: from, to: to, amount: amount, nonce: nonce, signature: DeterministicSignatureVerifier.sign(signer: from, message: stateMachine.canonicalMessage(for: unsigned)))
    }
}
`);
}

function ensureGitRepo(root) {
  if (!existsSync(join(root, ".git"))) git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "ScopeLock Wallet Demo"]);
  git(root, ["config", "user.email", "wallet-demo@scopelock.local"]);
  git(root, ["add", "."]);
  const status = run(root, "git", ["status", "--porcelain=v1"]).stdout.trim();
  if (status.length > 0) git(root, ["commit", "-m", "wallet fixture", "-q"]);
}

function contract(root, id, planned, read = [], activate = false, requireTest = true) {
  const draft = join(tmpdir(), `scopelock-wallet-${id}-${process.pid}.json`);
  const created = runCli(root, [
    "contract",
    "new",
    "--id",
    id,
    "--task",
    id,
    ...planned.flatMap((glob) => ["--planned", glob]),
    ...read.flatMap((glob) => ["--read", glob]),
    "--agent",
    "codex",
    ...(requireTest ? ["--test", "unit"] : []),
    "--out",
    draft,
  ]);
  if (created.status !== 0) throw new Error(created.stderr || created.stdout);
  const approved = runCli(root, ["approve", ...(activate ? [] : ["--no-activate"]), draft]);
  rmSync(draft, { force: true });
  if (approved.status !== 0) throw new Error(approved.stderr || approved.stdout);
  return `.scopelock/contracts/${id}.json`;
}

function setupScopeLock(root) {
  if (runCli(root, ["init"]).status !== 0) throw new Error("scopelock init failed");
  write(root, ".scopelock/config.json", JSON.stringify({ schemaVersion: 1, mode: "strict" }, null, 2));
  const installed = runCli(root, ["hooks", "install", "--target", "codex", "--mode", "strict", "--local"]);
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);

  const core = contract(
    root,
    "wallet-core-rules",
    ["Sources/WalletCore/WalletStateMachine.swift"],
    ["Sources/WalletCore/WalletTypes.swift"],
  );
  const tests = contract(
    root,
    "wallet-concurrency-tests",
    ["Tests/WalletCoreTests/WalletCoreTests.swift"],
    ["Sources/WalletCore/WalletActor.swift", "Sources/WalletCore/WalletStateMachine.swift"],
  );
  const docs = contract(
    root,
    "wallet-docs-demo",
    ["README.md", "Sources/WalletAssignment/WalletAssignmentDemo.swift"],
    ["Sources/WalletCore/**"],
  );

  write(root, ".scopelock/agents.json", JSON.stringify({
    schemaVersion: 1,
    targets: ["codex"],
    skills: [{ name: "wallet-domain-review", path: ".agents/skills/wallet-domain-review", required: true }],
    policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
  }, null, 2));
  write(root, "plan.json", JSON.stringify({
    schemaVersion: 1,
    planId: "wallet-demo",
    tasks: [
      { id: "wallet-core-rules", contract: core, command: [process.execPath, scriptPath, "--worker", "core"] },
      { id: "wallet-concurrency-tests", contract: tests, command: [process.execPath, scriptPath, "--worker", "tests"] },
      { id: "wallet-docs-demo", contract: docs, command: [process.execPath, scriptPath, "--worker", "docs"] },
    ],
  }, null, 2));
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "scopelock wallet demo setup", "-q"]);

  contract(root, "wallet-demo-run", [
    ".scopelock/contracts/wallet-demo-run.json",
    ".agents/skills/wallet-domain-review/SKILL.md",
    "Sources/WalletCore/WalletStateMachine.swift",
    "Tests/WalletCoreTests/WalletCoreTests.swift",
    "README.md",
    "Sources/WalletAssignment/WalletAssignmentDemo.swift",
  ], [], true, false);
}

function addWalletSkill(root) {
  write(root, ".agents/skills/wallet-domain-review/SKILL.md", `# Wallet Domain Review

Check wallet invariants before accepting changes:
- nonce must be strictly sequential;
- replay must fail deterministically;
- duplicate transaction ids must be rejected;
- actor mutation must stay serialized;
- swift test must pass.
`);
}

function workerCore(root) {
  const path = "Sources/WalletCore/WalletStateMachine.swift";
  const current = readFileSync(join(root, path), "utf8");
  if (current.includes("ScopeLock demo invariant marker")) return;
  write(root, path, current.replace(
    "guard !state.containsRecentTransactionID(transaction.id) else",
    "// ScopeLock demo invariant marker: replay is checked before nonce drift.\n        guard !state.containsRecentTransactionID(transaction.id) else",
  ));
}

function workerTests(root) {
  const path = "Tests/WalletCoreTests/WalletCoreTests.swift";
  const current = readFileSync(join(root, path), "utf8");
  if (current.includes("testScopeLockDemoNonceStillAdvancesOnce")) return;
  const test = `
    func testScopeLockDemoNonceStillAdvancesOnce() throws {
        let stateMachine = WalletStateMachine(verifier: verifier)
        let initialState = WalletState(walletID: "alex", balance: 100, nextExpectedNonce: 7)
        let transaction = makeSignedTransaction(id: "trscn-scopelock-demo", from: "alex", to: "bob", amount: 10, nonce: 7, stateMachine: stateMachine)
        let transition = try stateMachine.transition(from: initialState, event: .applyTransaction(transaction))
        XCTAssertEqual(transition.nextState.nextExpectedNonce, 8)
        XCTAssertEqual(transition.nextState.balance, 90)
    }

`;
  write(root, path, current.replace("    private func makeSignedTransaction(", `${test}    private func makeSignedTransaction(`));
}

function workerDocs(root) {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  if (!readme.includes("## ScopeLock demo note")) {
    write(root, "README.md", `${readme.trimEnd()}

## ScopeLock demo note

Wallet invariants are protected by deterministic tests and ScopeLock contracts.
`);
  }
  const demoPath = "Sources/WalletAssignment/WalletAssignmentDemo.swift";
  const demo = readFileSync(join(root, demoPath), "utf8");
  if (!demo.includes("ScopeLock demo")) {
    write(root, demoPath, demo.replace("WalletAssignment demo", "WalletAssignment demo - ScopeLock demo"));
  }
}

function runWorker(kind) {
  const root = process.cwd();
  if (kind === "core") workerCore(root);
  else if (kind === "tests") workerTests(root);
  else if (kind === "docs") workerDocs(root);
  else throw new Error(`unknown wallet worker: ${kind}`);
}

function swiftTest(root) {
  return run(root, "swift", ["test"]);
}

function blockedSummary(root, outputDir, source, reason, detail, keepFixture) {
  const summary = {
    generatedAt: new Date().toISOString(),
    source,
    blocked: true,
    reason,
    detail,
    fixture: keepFixture ? root : null,
    steps: {
      swiftAvailable: false,
      baselineTestsPassed: false,
      missingSkillBlocked: false,
      fixedPreflightPassed: false,
      safeWaves: [],
      hookDenied: false,
      finalRunPassed: false,
      finalSwiftTestsPassed: false,
      finalDriftClean: false,
      receiptSchemaVersion: null,
    },
    manualCommands: keepFixture ? manualReplayCommands(root) : [],
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function runWalletDemo(argv) {
  const keepFixture = argv.includes("--keep-fixture");
  const json = argv.includes("--json");
  const quiet = argv.includes("--quiet");
  const outputDir = resolve(option(argv, "--output-dir", join(repoRoot, ".scopelock/reports/wallet-demo")));
  const root = mkdtempSync(join(tmpdir(), "scopelock-wallet-demo-"));
  const source = cloneSource(root, argv);

  try {
    ensureGitRepo(root);
    if (!hasCommand("swift")) {
      const summary = blockedSummary(root, outputDir, source, "swift_unavailable", "`swift` is not available in PATH", keepFixture);
      if (json) process.stdout.write(`${JSON.stringify({ outputDir, ...summary }, null, 2)}\n`);
      else if (!quiet) process.stdout.write("ScopeLock Wallet Demo\nblocked: swift_unavailable\n");
      return summary;
    }

    const baseline = swiftTest(root);
    if (baseline.status !== 0) {
      const summary = blockedSummary(root, outputDir, source, "baseline_swift_test_failed", baseline.stderr || baseline.stdout, keepFixture);
      summary.steps.swiftAvailable = true;
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
      if (json) process.stdout.write(`${JSON.stringify({ outputDir, ...summary }, null, 2)}\n`);
      else if (!quiet) process.stdout.write("ScopeLock Wallet Demo\nblocked: baseline_swift_test_failed\n");
      return summary;
    }

    setupScopeLock(root);
    const blockedReceipt = join(root, ".scopelock/reports/wallet-blocked.json");
    const blocked = runCli(root, ["--json", "run", "--plan", "plan.json", "--receipt", blockedReceipt, "--no-check-drift"]);
    const blockedBody = JSON.parse(blocked.stdout);

    addWalletSkill(root);
    const preflight = runCli(root, ["--json", "agents", "preflight", "--manifest", ".scopelock/agents.json"]);
    const plan = runCli(root, ["--json", "plan-parallel", "plan.json", "--include-read-hazards"]);
    const planBody = JSON.parse(plan.stdout);

    const forbiddenEvent = JSON.stringify({
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Update File: Package.swift\n@@\n-// swift-tools-version: 6.2\n+// swift-tools-version: 6.1\n*** End Patch",
      },
    });
    const hook = runCli(root, ["hook", "gate", "--format", "codex"], forbiddenEvent);
    const hookBody = JSON.parse(hook.stdout);

    const finalReceipt = join(root, ".scopelock/reports/wallet-final.json");
    const finalRun = runCli(root, ["--json", "run", "--plan", "plan.json", "--receipt", finalReceipt, "--no-check-drift"]);
    const finalBody = JSON.parse(finalRun.stdout);
    const finalTests = swiftTest(root);
    const drift = runCli(root, ["--json", "check-drift"]);

    const summary = {
      generatedAt: new Date().toISOString(),
      source,
      blocked: false,
      fixture: keepFixture ? root : null,
      manualCommands: keepFixture ? manualReplayCommands(root) : [],
      steps: {
        swiftAvailable: true,
        baselineTestsPassed: baseline.status === 0,
        missingSkillBlocked: blocked.status === 1 && blockedBody.data.receipt.blockedByEnvironment === true,
        fixedPreflightPassed: preflight.status === 0,
        safeWaves: planBody.data.waves,
        hookDenied: hookBody.hookSpecificOutput?.permissionDecision === "deny",
        finalRunPassed: finalRun.status === 0,
        finalSwiftTestsPassed: finalTests.status === 0,
        finalDriftClean: drift.status === 0,
        receiptSchemaVersion: finalBody.data.receipt.schemaVersion,
      },
      receipts: {
        blocked: blockedReceipt,
        final: finalReceipt,
      },
    };

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(outputDir, "receipt.json"), `${JSON.stringify(finalBody.data.receipt, null, 2)}\n`);

    if (json) {
      process.stdout.write(`${JSON.stringify({ outputDir, ...summary }, null, 2)}\n`);
    } else if (!quiet) {
      process.stdout.write([
        "ScopeLock Wallet Demo",
        `source: ${source}`,
        `1. baseline swift test: ${summary.steps.baselineTestsPassed ? "PASS" : "FAIL"}`,
        `2. missing skill -> preflight block: ${summary.steps.missingSkillBlocked ? "PASS" : "FAIL"}`,
        `3. fix skill -> agents preflight: ${summary.steps.fixedPreflightPassed ? "PASS" : "FAIL"}`,
        `4. safe waves: ${summary.steps.safeWaves.map((wave) => `[${wave.join(", ")}]`).join(" -> ")}`,
        `5. Package.swift hook deny: ${summary.steps.hookDenied ? "PASS" : "FAIL"}`,
        `6. final swift test: ${summary.steps.finalSwiftTestsPassed ? "PASS" : "FAIL"}`,
        `7. final check-drift: ${summary.steps.finalDriftClean ? "PASS" : "FAIL"}`,
        `8. receipt v${summary.steps.receiptSchemaVersion}: ${join(outputDir, "receipt.json")}`,
        ...(keepFixture ? keepFixtureHint(root) : []),
      ].join("\n") + "\n");
    }
    return summary;
  } finally {
    if (!keepFixture) rmSync(root, { recursive: true, force: true });
  }
}

export { runWalletDemo };

if (process.argv[2] === "--worker") {
  try {
    runWorker(process.argv[3]);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runWalletDemo(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
