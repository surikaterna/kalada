import ts from "typescript";

export enum Flow {
  Host = 1 << 0,
  HostDerived = 1 << 1,
  UnknownHost = 1 << 2,
  Forbidden = 1 << 3,
  Reflect = 1 << 4,
  Object = 1 << 5,
  ReflectGet = 1 << 6,
  DescriptorGet = 1 << 7,
  ReflectConstruct = 1 << 8,
  SafeHostDerived = 1 << 9,
}

export interface AbstractValue {
  readonly flow: number;
  readonly bottom?: boolean;
  readonly keys?: readonly string[];
  readonly opaqueKey?: boolean;
  readonly keyComplete?: boolean;
  readonly elements?: readonly AbstractValue[];
  readonly functions?: readonly FunctionClosure[];
  readonly descriptor?: AbstractValue;
}

export interface FunctionClosure {
  readonly node: ts.FunctionLikeDeclaration;
  readonly captures?: ReadonlyMap<string, AbstractValue>;
  readonly capabilitySource?: boolean;
  readonly bounded: boolean;
}

export const SAFE: AbstractValue = Object.freeze({ flow: 0 });
export const BOTTOM: AbstractValue = Object.freeze({ flow: 0, bottom: true });

export function flowing(flow: Flow): AbstractValue {
  return { flow };
}

export function keyValue(key: string): AbstractValue {
  return { flow: 0, keys: [key], keyComplete: true };
}

export function opaqueKey(): AbstractValue {
  return { flow: 0, opaqueKey: true, keyComplete: true };
}

export function arrayValue(elements: readonly AbstractValue[]): AbstractValue {
  return { flow: 0, elements };
}

export function directFunctionValue(
  node: ts.FunctionLikeDeclaration,
  captures?: ReadonlyMap<string, AbstractValue>,
  capabilitySource = captureHasCapability(captures),
): AbstractValue {
  return isBoundedFunction(node)
    ? { flow: 0, functions: [{ node, captures, capabilitySource, bounded: true }] }
    : { flow: 0, functions: [{ node, captures, capabilitySource, bounded: false }] };
}

export function descriptorValue(value: AbstractValue): AbstractValue {
  return { flow: 0, descriptor: value };
}

export function hasFlow(value: AbstractValue, flow: Flow): boolean {
  return (value.flow & flow) !== 0;
}

export function hasHostFlow(value: AbstractValue): boolean {
  return (
    (value.flow & (Flow.Host | Flow.HostDerived | Flow.UnknownHost | Flow.SafeHostDerived)) !== 0
  );
}

export function hasCapabilityFlow(value: AbstractValue): boolean {
  return (value.flow & ~Flow.SafeHostDerived) !== 0 || value.descriptor !== undefined;
}

export function hasCallableCapability(value: AbstractValue): boolean {
  return value.functions?.some((closure) => closure.capabilitySource) === true;
}

export function capabilityCaptures(
  values: ReadonlyMap<string, AbstractValue>,
): ReadonlyMap<string, AbstractValue> | undefined {
  const captures = new Map(
    [...values].filter(([, value]) => hasCapabilityFlow(value) || hasCallableCapability(value)),
  );
  return captures.size ? captures : undefined;
}

export function mergeCaptureMaps(
  left: ReadonlyMap<string, AbstractValue> | undefined,
  right: ReadonlyMap<string, AbstractValue>,
): ReadonlyMap<string, AbstractValue> | undefined {
  const captures = new Map(left ?? []);
  for (const [name, value] of right) captures.set(name, value);
  return captures.size ? captures : undefined;
}

export function mergeValues(left: AbstractValue, right: AbstractValue): AbstractValue {
  if (left.bottom) return right;
  if (right.bottom) return left;
  const keys = mergeStrings(left.keys, right.keys);
  const functions = mergeFunctions(left.functions, right.functions);
  return {
    flow: left.flow | right.flow,
    ...(keys.length ? { keys } : {}),
    ...(left.opaqueKey || right.opaqueKey ? { opaqueKey: true } : {}),
    ...(left.keyComplete && right.keyComplete ? { keyComplete: true } : {}),
    ...mergeElements(left.elements, right.elements),
    ...(functions.length ? { functions } : {}),
    ...mergeDescriptor(left.descriptor, right.descriptor),
  };
}

export function mergeAll(values: readonly AbstractValue[]): AbstractValue {
  return values.reduce(mergeValues, BOTTOM);
}

export function valueSignature(value: AbstractValue): string {
  const elements = value.elements?.map(valueSignature).join(";") ?? "";
  const functions =
    value.functions
      ?.map(
        ({ node, captures, capabilitySource, bounded }) =>
          `${node.pos}:${capabilitySource ? 1 : 0}:${bounded ? 1 : 0}:${captureSignature(captures)}`,
      )
      .join(",") ?? "";
  const descriptor = value.descriptor ? valueSignature(value.descriptor) : "";
  return [
    value.flow,
    value.bottom ? 1 : 0,
    value.keys?.join(",") ?? "",
    value.opaqueKey ? 1 : 0,
    value.keyComplete ? 1 : 0,
    elements,
    functions,
    descriptor,
  ].join("|");
}

export function staticString(value: ts.Expression | undefined): string | undefined {
  if (!value) return undefined;
  const expression = unwrapExpression(value);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) return staticTemplate(expression);
  if (isStringAddition(expression)) {
    const left = staticString(expression.left);
    const right = staticString(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isCallExpression(expression) && memberName(expression.expression) === "concat") {
    const owner = memberOwner(expression.expression);
    const parts = [owner && staticString(owner), ...expression.arguments.map(staticString)];
    return parts.some((part) => part === undefined) ? undefined : parts.join("");
  }
  return undefined;
}

export function unwrapExpression(value: ts.Expression): ts.Expression {
  let expression = value;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isPartiallyEmittedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

export function memberName(value: ts.Expression): string | undefined {
  const expression = unwrapExpression(value);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) return staticString(expression.argumentExpression);
  return undefined;
}

export function memberOwner(value: ts.Expression): ts.Expression | undefined {
  const expression = unwrapExpression(value);
  return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
    ? expression.expression
    : undefined;
}

export function isLogicalOperator(kind: ts.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ].includes(kind);
}

export function isInertLiteralArray(node: ts.ArrayLiteralExpression): boolean {
  return node.elements.every(
    (element) =>
      ts.isNumericLiteral(element) ||
      ts.isStringLiteral(element) ||
      element.kind === ts.SyntaxKind.TrueKeyword ||
      element.kind === ts.SyntaxKind.FalseKeyword ||
      element.kind === ts.SyntaxKind.NullKeyword,
  );
}

function isStringAddition(
  value: ts.Expression,
): value is ts.BinaryExpression & { operatorToken: { kind: ts.SyntaxKind.PlusToken } } {
  return ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

function staticTemplate(value: ts.TemplateExpression): string | undefined {
  let result = value.head.text;
  for (const span of value.templateSpans) {
    const expression = staticString(span.expression);
    if (expression === undefined) return undefined;
    result += expression + span.literal.text;
  }
  return result;
}

function mergeStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])].sort();
}

function mergeFunctions(
  left: readonly FunctionClosure[] | undefined,
  right: readonly FunctionClosure[] | undefined,
): FunctionClosure[] {
  return [
    ...new Map(
      [...(left ?? []), ...(right ?? [])].map((closure) => [
        `${closure.node.pos}:${closure.capabilitySource ? 1 : 0}:${closure.bounded ? 1 : 0}:${captureSignature(closure.captures)}`,
        closure,
      ]),
    ).values(),
  ];
}

function mergeElements(
  left: readonly AbstractValue[] | undefined,
  right: readonly AbstractValue[] | undefined,
): Pick<AbstractValue, "elements"> {
  if (!left) return right ? { elements: right } : {};
  if (!right) return { elements: left };
  const length = Math.max(left.length, right.length);
  return {
    elements: Array.from({ length }, (_, index) =>
      mergeValues(left[index] ?? SAFE, right[index] ?? SAFE),
    ),
  };
}

function mergeDescriptor(
  left: AbstractValue | undefined,
  right: AbstractValue | undefined,
): Pick<AbstractValue, "descriptor"> {
  if (!left) return right ? { descriptor: right } : {};
  if (!right) return { descriptor: left };
  return { descriptor: mergeValues(left, right) };
}

function isBoundedFunction(node: ts.FunctionLikeDeclaration): boolean {
  if (node.end - node.pos > 1_000 || !node.body) return false;
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return true;
  if (!ts.isBlock(node.body) || node.body.statements.length > 12) return false;
  return node.body.statements.every(isSummaryStatement);
}

function isSummaryStatement(statement: ts.Statement): boolean {
  return (
    ts.isReturnStatement(statement) ||
    ts.isVariableStatement(statement) ||
    ts.isExpressionStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  );
}

function captureSignature(captures: ReadonlyMap<string, AbstractValue> | undefined): string {
  if (!captures) return "";
  return [...captures]
    .map(([name, value]) => `${name}=${value.flow}`)
    .sort()
    .join(",");
}

function captureHasCapability(captures: ReadonlyMap<string, AbstractValue> | undefined): boolean {
  return captures ? [...captures.values()].some(hasCapabilityFlow) : false;
}
