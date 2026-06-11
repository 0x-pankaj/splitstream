// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IUSYCTeller
 * @notice Minimal interface for Circle's USYC Teller on Arc, which mints and
 *         redeems the USYC yield token from/to USDC for allowlisted addresses.
 *
 * @dev On Arc Testnet the real Teller lives at
 *      0x9fdF14c5B14173D74C08Af27AebFf39240dC105A but requires Entitlements
 *      allowlisting (24-48h, $100k minimum, non-US institutions). For local
 *      tests and the live demo we wire `MockUSYCTeller`, which models the same
 *      surface deterministically. The interface is intentionally simple; the
 *      production integration would conform to Circle's published ABI.
 */
interface IUSYCTeller {
    /// @notice Deposit USDC (6dp) and receive USYC shares (6dp).
    /// @param usdcAmount Amount of USDC to convert into yield-bearing USYC.
    /// @return usycMinted USYC shares credited to msg.sender.
    function deposit(uint256 usdcAmount) external returns (uint256 usycMinted);

    /// @notice Redeem USYC shares (6dp) back into liquid USDC (6dp).
    /// @param usycAmount Amount of USYC shares to redeem.
    /// @return usdcReturned USDC returned to msg.sender (principal + accrued yield).
    function redeem(uint256 usycAmount) external returns (uint256 usdcReturned);

    /// @notice The USYC share token managed by this Teller.
    function usyc() external view returns (address);
}
