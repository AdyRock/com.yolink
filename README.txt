Adds support to connect YoLink devices to Homey via the cloud using the UUID and secrect found in the YoLink app.
A YoLink hub is required for devices to send information to the cloud so that Homey can use them as they use a LoRa signal that is not supported by Homey.
Create Flows to respond quickly to notifications from sensor and play sounds and messages on the speaker hub.
Empower Homey to do even more in your home automation by combining the long range YoLink sensors with Homey's processing power.

The water meter controller exposes flow-duration, water-amount, daily usage count,
valve-open reminder, reminder, freeze, and high/low temperature alarms when reported
by the device. "Overrun Amount Alarm" covers both amountOverrun and
overrunAmount24H alarm reports.
Use the "A water meter alarm turns on" Flow trigger to choose an alarm and send a
notification. Water flow, recent flow duration, temperature, power source and
remaining valve delays are also shown when the device reports them.
Flow triggers are available for alarm activation and clearing, water starting or
stopping, temperature, recent flow duration, power source, and valve delay changes.
The controller requests its state at startup. Newly paired devices add optional
capabilities only when a valid value is reported, including zero and inactive
alarms. Once added, capabilities remain available even when later reports omit
them. Existing paired devices retain their capabilities and Flows.
