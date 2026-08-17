# Introduction to Trigonometry

Trigonometry begins with a simple observation: in a right-angled triangle, the ratios between the sides depend only on the angles, not on how big the triangle is. Two right triangles with the same acute angle are similar, so their corresponding sides are in the same proportion. That single fact is what makes the whole subject work.

## Naming the sides

Fix one acute angle in a right triangle and call it $\theta$. The three sides then get names relative to that angle.

The **hypotenuse** is the side opposite the right angle. It is always the longest side, and it does not change when you switch which acute angle you are looking at.

The **opposite** side is the one across from $\theta$. The **adjacent** side is the one next to $\theta$ that is not the hypotenuse.

The point that catches people out: opposite and adjacent swap over when you change the reference angle. In a triangle with acute angles $\theta$ and $\phi$, the side that is opposite $\theta$ is adjacent to $\phi$. The hypotenuse stays put. Whenever a problem involves both acute angles, redraw or relabel rather than trying to hold both namings in your head.

## The three ratios

For an acute angle $\theta$ in a right triangle:

$$\sin\theta = \frac{\text{opposite}}{\text{hypotenuse}}, \qquad \cos\theta = \frac{\text{adjacent}}{\text{hypotenuse}}, \qquad \tan\theta = \frac{\text{opposite}}{\text{adjacent}}$$

These are the sine, cosine and tangent of $\theta$. The mnemonic SOH CAH TOA records exactly this and nothing more.

Because the sides of similar triangles are proportional, these ratios depend only on $\theta$. Double every side and all three ratios are unchanged. This is why we can speak of "the sine of 30 degrees" as a number, without reference to any particular triangle.

Three more ratios are the reciprocals of these:

$$\csc\theta = \frac{1}{\sin\theta}, \qquad \sec\theta = \frac{1}{\cos\theta}, \qquad \cot\theta = \frac{1}{\tan\theta}$$

In Commonwealth textbooks $\csc$ is written $\operatorname{cosec}$. They are the same function. Note that secant pairs with cosine and cosecant pairs with sine — the opposite of what the names suggest, which is a common source of slips.

Since the hypotenuse is the longest side, both the opposite and adjacent sides are shorter than it. So $\sin\theta$ and $\cos\theta$ are always between 0 and 1 for an acute angle. If a calculation gives you $\sin\theta = 1.4$, you have made an arithmetic error somewhere — no acute angle has a sine above 1.

## Ratios of the standard angles

Certain angles turn up constantly, and their exact values are worth deriving rather than memorising, because the derivation is short and the memory is unreliable.

Take an equilateral triangle with sides of length 2 and drop a perpendicular from one vertex. This splits it into two right triangles with angles 30, 60 and 90 degrees. The hypotenuse is 2, the base is 1, and by Pythagoras the height is $\sqrt{3}$. Reading the ratios off that triangle gives every value for 30 and 60 degrees.

For 45 degrees, take a right triangle with both legs equal to 1. The hypotenuse is $\sqrt{2}$, so both sine and cosine are $1/\sqrt{2}$.

The full table:

$$\sin 30° = \tfrac{1}{2}, \quad \sin 45° = \tfrac{1}{\sqrt2}, \quad \sin 60° = \tfrac{\sqrt3}{2}$$

$$\cos 30° = \tfrac{\sqrt3}{2}, \quad \cos 45° = \tfrac{1}{\sqrt2}, \quad \cos 60° = \tfrac{1}{2}$$

Notice that the cosine values are the sine values read backwards. That is not a coincidence: $\cos\theta = \sin(90° - \theta)$, because the adjacent side for one acute angle is the opposite side for the other.

At the boundaries, $\sin 0° = 0$ and $\cos 0° = 1$, while $\sin 90° = 1$ and $\cos 90° = 0$. Tangent is undefined at 90 degrees, because the adjacent side has shrunk to nothing and you would be dividing by zero.

## The Pythagorean identity

This is the single most used identity in the subject.

Start with a right triangle with hypotenuse $h$, opposite side $o$ and adjacent side $a$. Pythagoras' theorem says $o^2 + a^2 = h^2$. Divide every term by $h^2$:

$$\frac{o^2}{h^2} + \frac{a^2}{h^2} = 1$$

But $o/h$ is exactly $\sin\theta$ and $a/h$ is exactly $\cos\theta$. So:

$$\sin^2\theta + \cos^2\theta = 1$$

This holds for every angle, not just acute ones. The notation $\sin^2\theta$ means $(\sin\theta)^2$ — the square of the sine, not the sine of $\theta^2$. Writing it as $\sin\theta^2$ is a genuine error and will give the wrong answer.

The identity is most useful for finding one ratio from another. If you know $\sin\theta = 3/5$ and that $\theta$ is acute, then $\cos^2\theta = 1 - 9/25 = 16/25$, so $\cos\theta = 4/5$. Taking the positive root is correct here only because $\theta$ is acute; for a general angle you must decide the sign from the quadrant.

## The derived identities

Divide the Pythagorean identity through by $\cos^2\theta$:

$$\frac{\sin^2\theta}{\cos^2\theta} + 1 = \frac{1}{\cos^2\theta} \quad \Longrightarrow \quad \tan^2\theta + 1 = \sec^2\theta$$

Divide it instead by $\sin^2\theta$:

$$1 + \cot^2\theta = \csc^2\theta$$

All three are the same fact wearing different clothes. Which one to reach for depends on what the expression in front of you already contains: if you can see a $\tan$ and a $\sec$, the second form will collapse it; if you can see a $\cot$ and a $\csc$, use the third.

## Proving identities

The standard task is to show that one expression equals another. There is a reliable method.

Work on one side only, and transform it until it matches the other. Do not operate on both sides at once — multiplying both sides by something, or squaring both sides, assumes the very equality you are trying to establish. That is circular, and it will be marked wrong even when the identity is true.

Start from the more complicated side. There is more to simplify and more room to manoeuvre.

When stuck, convert everything to sines and cosines. Every ratio is expressible in those two, and once everything is in a common language the algebra usually becomes obvious.

Look for a Pythagorean form to substitute. An expression containing $1 - \sin^2\theta$ is really $\cos^2\theta$ in disguise; $\sec^2\theta - 1$ is $\tan^2\theta$. Spotting these is most of the skill.

As a worked example, take $\dfrac{\cos\theta}{1-\sin\theta} = \sec\theta + \tan\theta$. Start on the left and multiply top and bottom by $1+\sin\theta$. The denominator becomes $1-\sin^2\theta$, which is $\cos^2\theta$. The fraction is then $\dfrac{\cos\theta(1+\sin\theta)}{\cos^2\theta} = \dfrac{1+\sin\theta}{\cos\theta}$, which splits into $\sec\theta + \tan\theta$.

# Applications: Heights and Distances

## Angles of elevation and depression

If you look up at something, the angle between your line of sight and the horizontal is the **angle of elevation**. If you look down, it is the **angle of depression**. Both are measured from the horizontal, never from the vertical — this is the most common mistake in the topic.

The two are related: the angle of depression from a window down to a car equals the angle of elevation from the car up to the window, because the two horizontals are parallel and these are alternate angles.

Always draw the diagram. Mark the right angle, label the known side and the known angle, and only then decide which ratio to use. The ratio to choose is the one that connects what you know to what you want: if you know the adjacent side and want the opposite, that is tangent.

## Problems with two triangles

Harder problems give two observations of the same object, and the two right triangles share a side.

A typical example: from a point on the ground the angle of elevation to the top of a tower is 30 degrees. Walking 40 metres closer, the angle becomes 60 degrees. Find the height.

Let the height be $h$ and the distance from the tower at the nearer point be $x$. From the near point, $\tan 60° = h/x$, so $h = x\sqrt{3}$. From the far point, $\tan 30° = h/(x+40)$, so $h = (x+40)/\sqrt{3}$.

Setting these equal gives $x\sqrt{3} = (x+40)/\sqrt{3}$, so $3x = x + 40$ and $x = 20$. The height is $20\sqrt{3}$, about 34.6 metres.

The pattern generalises: express the shared side from both triangles, set the two expressions equal, and solve. The unknown distance drops out and the height is left.
