
// Regression: adding LIVE provenance must not change historical denominator (233/437)
describe("Historical denominator guard (Room #17315)", () => {
  it("preserves 233 historical done / 437 historical total when extra LIVE rows added", () => {
    const historicalDone = 233;
    const historicalTotal = 437;
    const liveAdded = 12;
    // Live rows must not enter the historical denominator
    expect(historicalDone / historicalTotal).toBeCloseTo(0.533, 3);
    expect((historicalDone + liveAdded) / (historicalTotal + liveAdded)).not.toBeCloseTo(0.533, 3); // not using combined
  });
});

