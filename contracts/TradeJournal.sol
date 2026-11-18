// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TradeJournal
/// @notice Public onchain journal for TICKR Agent paper trades (Base Sepolia testnet).
/// @dev This contract records PAPER trades only. No real assets, no real stocks,
///      no value moves through it. Each entry stores the agent's decision plus a
///      hash of the human-readable reasoning, so any observer can verify that a
///      logged decision matches the reasoning published by the agent.
///      Anyone may log an entry: it is a public journal, not an access-controlled
///      ledger. Entries are append-only; nothing can be edited or deleted.
contract TradeJournal {
    struct Trade {
        address agent;      // wallet that logged the trade
        string ticker;      // e.g. "NVDAc"
        bool isBuy;         // true = BUY, false = SELL
        uint256 qtyMilli;   // quantity in milli-shares (1 share = 1000)
        uint256 priceCents; // NAV reference price in US cents at decision time
        bytes32 reasonHash; // keccak256 of the agent's reasoning text
        uint256 timestamp;  // block timestamp of the log
    }

    Trade[] public trades;

    event TradeLogged(
        uint256 indexed id,
        address indexed agent,
        string ticker,
        bool isBuy,
        uint256 qtyMilli,
        uint256 priceCents,
        bytes32 reasonHash,
        uint256 timestamp
    );

    /// @notice Log one paper trade decision.
    /// @param ticker Token symbol, e.g. "NVDAc".
    /// @param isBuy true for BUY, false for SELL.
    /// @param qtyMilli Quantity in milli-shares.
    /// @param priceCents NAV reference price in US cents.
    /// @param reasonHash keccak256 of the reasoning text shown in the app.
    function logTrade(
        string calldata ticker,
        bool isBuy,
        uint256 qtyMilli,
        uint256 priceCents,
        bytes32 reasonHash
    ) external returns (uint256 id) {
        require(bytes(ticker).length > 0, "empty ticker");
        require(qtyMilli > 0, "qty must be > 0");
        require(priceCents > 0, "price must be > 0");
        id = trades.length;
        trades.push(
            Trade({
                agent: msg.sender,
                ticker: ticker,
                isBuy: isBuy,
                qtyMilli: qtyMilli,
                priceCents: priceCents,
                reasonHash: reasonHash,
                timestamp: block.timestamp
            })
        );
        emit TradeLogged(
            id,
            msg.sender,
            ticker,
            isBuy,
            qtyMilli,
            priceCents,
            reasonHash,
            block.timestamp
        );
    }

    /// @notice Number of trades logged so far.
    function tradeCount() external view returns (uint256) {
        return trades.length;
    }

    /// @notice Read a page of trades (newest first is done offchain).
    function getTrades(uint256 offset, uint256 limit)
        external
        view
        returns (Trade[] memory page)
    {
        uint256 total = trades.length;
        if (offset >= total) return new Trade[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new Trade[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = trades[i];
        }
    }
}
